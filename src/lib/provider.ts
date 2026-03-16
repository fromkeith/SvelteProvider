import {
  writable,
  type Writable,
  type Readable,
  type Subscriber,
  type Unsubscriber,
} from "svelte/store";

import { log } from "./log";
import { UNSET } from "./sentinel";
import { getClassId } from "./utils";

// Shared across all providers
const instances = new Map<string, any>();

// Type utilities - extract the resolved value type from a Provider tuple
export type ExtractProviderValue<P> =
  P extends Provider<infer T, any, any> ? T : never;
export type ExtractProviderValues<Deps extends Provider<any, any, any>[]> = {
  [K in keyof Deps]: ExtractProviderValue<Deps[K]>;
};

/**
 * Abstract base class for reactive, dependency-injectable providers.
 *
 * Generic parameters:
 *  - `T`    - the value type produced by this provider
 *  - `Args` - constructor argument types (for parameterised providers)
 *  - `Deps` - the tuple of dependency Provider types whose resolved values
 *             are forwarded to `build()` (#2)
 */
export abstract class Provider<
  T,
  Args extends any[] = [],
  Deps extends Provider<any, any, any>[] = Provider<any, any, any>[],
> implements Readable<T> {
  // providerName is kept for backwards compatibility but no longer required
  public static providerName?: string;

  public subscribe: (run: Subscriber<any>) => Unsubscriber;

  // Internal writable stores - set only by the Provider internals
  private _isLoading: Writable<boolean>;
  private _error: Writable<any | null>;

  // Public stores wrap the internals so that subscribing to isLoading or
  // error also triggers the same lazy-load as subscribing to the value store.
  // This eliminates the subscription-order bug described in the README quirks.
  public isLoading: Writable<boolean>;
  public error: Writable<any | null>;

  private store: Writable<T | null>;
  private reliesOn: Provider<any, any, any>[];
  private unsubs: Unsubscriber[] = [];
  private instanceKey: string = "";
  private promiseImpl?: Promise<T | null>;
  // Cached public promise - cleared in markDirty() so each build cycle
  // produces exactly one Promise instance regardless of how many times the
  // getter is accessed.
  private _cachedPromise?: Promise<T>;
  private initial: T | null;
  private isDirty: boolean = false;
  private doAbort: boolean = false;
  private hasRun: boolean = false;
  private subSubscriber: Unsubscriber | undefined;
  public keepAlive: boolean = false;
  private _pendingDelete: boolean = false;

  // Returns the same Promise for the lifetime of a single build cycle.
  public get promise(): Promise<T> {
    if (!this._cachedPromise) {
      this._cachedPromise = new Promise<T>((resolve, reject) => {
        let unsub: Unsubscriber;
        let errorSub: Unsubscriber;
        unsub = this.subscribe((v: T) => {
          if (this.isAncestorDirty()) return;
          if (this.hasRun) {
            unsub?.();
            errorSub?.();
            log("resolving promise");
            resolve(v);
          }
        });
        // Use the internal _error store directly to avoid the extra main-store
        // subscription that the public error wrapper would introduce.
        errorSub = this._error.subscribe((v) => {
          if (this.isAncestorDirty()) return;
          if (v) {
            errorSub?.();
            unsub?.();
            log("rejecting promise");
            reject(v);
          }
        });
      });
    }
    return this._cachedPromise;
  }

  constructor(initial: T | null, ...reliesOn: Deps) {
    log("creating new");
    this.initial = initial;
    this.reliesOn = reliesOn as unknown as Provider<any, any, any>[];
    let isInitial = true;

    this._isLoading = writable(true);
    this._error = writable(null);

    // Start the store with UNSET (not null) so that store.set(null) always
    // fires a notification - even when the provider legitimately resolves to null.
    this.store = writable(
      (initial === null ? UNSET : initial) as unknown as T | null,
      () => {
        // Cancel any deferred deletion queued from the previous stop.
        this._pendingDelete = false;
        log(`writable first ${isInitial} ${this.instanceKey}`);
        if (isInitial && this.reliesOn.length === 0) {
          this.markDirty();
        }
        isInitial = false;
        for (const p of this.reliesOn) {
          const k = p;
          this.unsubs.push(
            p.subscribe(() => {
              if (k.isDirty) return;
              log(`${k.instanceKey} updated, so ${this.instanceKey} is dirty`);
              this.markDirty();
            }),
          );
          // Subscribe to the internal _error store to avoid a recursive
          // activation loop through the public error wrapper.
          this.unsubs.push(
            p._error.subscribe(() => {
              if (k.isDirty) return;
              log(`${k.instanceKey} failed, so ${this.instanceKey} is dirty`);
              this.markDirty();
            }),
          );
        }

        return () => {
          log(`writable ended ${this.instanceKey}`);
          for (const u of this.unsubs) {
            u();
          }
          this.unsubs = [];
          if (!this.keepAlive) {
            // Defer removal so that a re-subscription arriving in the same
            // microtask tick (e.g. during SvelteKit page navigation) can cancel
            // the deletion and reuse the cached instance without a re-fetch.
            this._pendingDelete = true;
            queueMicrotask(() => {
              if (this._pendingDelete) {
                Provider.queueForDelete(this);
              }
            });
          }
        };
      },
    );

    // isLoading - subscribing triggers the main store's lazy-load notifier.
    this.isLoading = {
      subscribe: (run: Subscriber<boolean>) => {
        const mainUnsub = this.store.subscribe(() => {});
        const sub = this._isLoading.subscribe(run);
        return () => {
          mainUnsub();
          sub();
        };
      },
      set: (v: boolean) => this._isLoading.set(v),
      update: (fn: (v: boolean) => boolean) => this._isLoading.update(fn),
    };

    // error - same treatment as isLoading.
    this.error = {
      subscribe: (run: Subscriber<any>) => {
        const mainUnsub = this.store.subscribe(() => {});
        const sub = this._error.subscribe(run);
        return () => {
          mainUnsub();
          sub();
        };
      },
      set: (v: any) => this._error.set(v),
      update: (fn: (v: any) => any) => this._error.update(fn),
    };

    this.subscribe = (run: Subscriber<any>) => {
      log(`subscribe to ${this.instanceKey}`);
      // Translate the internal UNSET sentinel to null for external subscribers.
      return this.store.subscribe((v) =>
        run((v as unknown) === UNSET ? null : v),
      );
    };
  }

  private isAncestorDirty(): boolean {
    if (this.isDirty) {
      return true;
    }
    for (const p of this.reliesOn) {
      if (p.isAncestorDirty()) {
        return true;
      }
    }
    return false;
  }

  private markDirty(): void {
    // Invalidate cached promise so the next access creates a fresh one
    this._cachedPromise = undefined;
    if (!this.isDirty) {
      this._isLoading.set(true);
      this.isDirty = true;
      this.doAbort = false;
      this.promiseImpl = undefined;
      queueMicrotask(() => {
        if (this.isDirty) {
          this.refresh().catch(() => {});
        }
      });
    } else if (this.promiseImpl) {
      // Actively refreshing - signal that we need to restart
      this.doAbort = true;
    }
  }

  private static queueForDelete(provider: Provider<any, any, any>): void {
    instances.delete(provider.instanceKey);
  }

  private static getInstance<T, Args extends any[]>(
    this: new (...args: Args) => Provider<T, Args, any>,
    ...args: Args
  ): Provider<T, Args, any> {
    // #9: Use the stable numeric class ID rather than this.name so that
    // minified builds don't corrupt the singleton cache.
    const id = getClassId(this);
    const key = `${id};${JSON.stringify(args)}`;
    log(`getInstance ${key}`);
    if (!instances.has(key)) {
      log(`--createInstance ${key}`);
      const newProvider = new this(...args);
      newProvider.instanceKey = key;
      instances.set(key, newProvider);
    }
    return instances.get(key);
  }

  static create<
    T,
    Args extends any[] = [],
    P extends Provider<T, Args, any> = Provider<T, Args, any>,
  >(this: new (...args: Args) => P): (...args: Args) => P {
    return new Proxy(this, {
      apply(target: any, _thisArg: any, args: unknown[]) {
        return target.getInstance(...args);
      },
    }) as (...args: Args) => P;
  }

  private async refresh(): Promise<T | null> {
    this._isLoading.set(true);
    this._error.set(null);
    this.promiseImpl = this.refreshImpl();
    // Attach a no-op catch so that a rejected promiseImpl is never an
    // unhandled rejection when no dependent is currently awaiting it.
    this.promiseImpl.catch(() => {});
    return this.promiseImpl;
  }

  private async refreshImpl(): Promise<T | null> {
    this.doAbort = false;
    this.subSubscriber?.();
    this.subSubscriber = undefined;
    log(`refreshing ${this.instanceKey}`);
    try {
      const deps: any[] = [];
      for (const p of this.reliesOn) {
        if (this.doAbort) {
          return this.refreshImpl();
        }
        if (p.promiseImpl != undefined) {
          log(
            `--wait other: ${this.instanceKey} asking for ${p.instanceKey}'s promise`,
          );
          deps.push(await p.promiseImpl);
        } else {
          log(
            `--refresh other: ${this.instanceKey} asking for ${p.instanceKey}`,
          );
          deps.push(await p.promise);
        }
      }
      if (this.doAbort) {
        return this.refreshImpl();
      }
      const buildResult = this.build(...(deps as ExtractProviderValues<Deps>));
      if (!(buildResult as Readable<T>).subscribe) {
        const val = await (buildResult as Promise<T>);
        if (this.doAbort) {
          return this.refreshImpl();
        }
        this.isDirty = false;
        this.hasRun = true;
        this.store.set(val);
        return val;
      }
      // build() returned a Readable - subscribe and forward values
      const asStore = buildResult as Readable<T>;
      let hasGotValue = false;
      return new Promise((resolve) => {
        this.subSubscriber = asStore.subscribe((val) => {
          if (!hasGotValue) {
            this.isDirty = false;
            this.hasRun = true;
            hasGotValue = true;
            resolve(val);
          }
          // Clear stale promises so dependents calling p.promiseImpl or
          // p.promise during their next refresh receive the current value,
          // not the one from the initial load.
          this._cachedPromise = undefined;
          this.promiseImpl = undefined;
          this.store.set(val);
        });
      });
    } catch (ex: any) {
      log(`failed to refresh ${this.instanceKey}`);
      this.isDirty = false;
      this.hasRun = true;
      this._error.set(ex);
      this.store.set(null);
      return Promise.reject(ex);
    } finally {
      this._isLoading.set(false);
    }
  }

  /** Set the new state of this build manually */
  protected async setState(newState: T | Promise<T>): Promise<void> {
    const p =
      newState instanceof Promise ? newState : Promise.resolve(newState);
    this.promiseImpl = p;
    this._cachedPromise = undefined;
    try {
      const val = await this.promiseImpl;
      this.store.set(val);
    } catch (ex: any) {
      this._error.set(ex);
      this.store.set(null);
    }
  }

  // public invalidate
  public invalidate(): Promise<T | null> {
    return this.invalidateSelf();
  }

  protected invalidateSelf(): Promise<T | null> {
    log(`invalidate: ${this.instanceKey}`);
    this.promiseImpl = undefined;
    // Reset to UNSET (not null) so that a subsequent store.set(null) is always
    // a real change and subscribers are notified even when the result is null.
    this.store.set(UNSET as unknown as T | null);
    this._error.set(null);
    this._isLoading.set(true);
    this.markDirty();
    return this.promise;
  }

  // implemented by the user, Deps based on types
  protected abstract build(
    ...deps: ExtractProviderValues<Deps>
  ): Promise<T> | Readable<T>;
}
