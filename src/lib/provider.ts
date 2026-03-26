import {
  writable,
  get,
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

/** Extracts the resolved value type `T` from a `Provider<T, ...>` or `Readable<T>`. */
export type ExtractProviderValue<P> =
  P extends Provider<infer T, any, any> ? T :
  P extends Readable<infer T> ? T :
  never;

/** Maps a tuple of Provider or Readable types to a tuple of their resolved value types. */
export type ExtractProviderValues<Deps extends (Provider<any, any, any> | Readable<any>)[]> = {
  [K in keyof Deps]: ExtractProviderValue<Deps[K]>;
};

/**
 * Abstract base class for reactive, lazy-loaded, singleton providers.
 *
 * Providers are Svelte `Readable` stores. They load on first subscriber,
 * automatically re-run when dependencies change, and cache their singleton
 * instance per unique constructor-argument combination.
 *
 * ### Generics
 * - `T`    — the value type produced by `build()`
 * - `Args` — constructor argument tuple (used by `create()` to key the cache)
 * - `Deps` — tuple of dependency `Provider` types whose resolved values are
 *            forwarded as positional arguments to `build()`
 *
 * ### Basic usage
 * ```ts
 * class PostsProvider extends Provider<Post[]> {
 *   constructor() { super(null); }
 *   protected async build(): Promise<Post[]> {
 *     return fetch('/api/posts').then(r => r.json());
 *   }
 * }
 * export const postsProvider = PostsProvider.create();
 * ```
 *
 * ### With dependencies
 * ```ts
 * class UserPostsProvider extends Provider<Post[], [], [AccountProvider]> {
 *   constructor() { super(null, accountProvider()); }
 *   protected async build(account: IAccount): Promise<Post[]> {
 *     return fetch(`/api/users/${account.id}/posts`).then(r => r.json());
 *   }
 * }
 * ```
 *
 * ### Parameterised (one instance per argument combination)
 * ```ts
 * class PostProvider extends Provider<Post, [string]> {
 *   constructor(private postId: string) { super(null); }
 *   protected async build(): Promise<Post> {
 *     return fetch(`/api/posts/${this.postId}`).then(r => r.json());
 *   }
 * }
 * export const postProvider = PostProvider.create();
 * // postProvider('123') and postProvider('456') are separate cached instances
 * ```
 */
export abstract class Provider<
  T,
  Args extends any[] = [],
  Deps extends (Provider<any, any, any> | Readable<any>)[] = (Provider<any, any, any> | Readable<any>)[],
> implements Readable<T> {
  // providerName is kept for backwards compatibility but no longer required
  public static providerName?: string;

  /** Svelte `Readable` subscribe — prefix with `$` in components. */
  public subscribe: (run: Subscriber<any>) => Unsubscriber;

  // Internal writable stores - set only by the Provider internals
  private _isLoading: Writable<boolean>;
  private _error: Writable<any | null>;

  /**
   * Svelte store that is `true` while `build()` is in-flight.
   * Subscribing to this store also activates the provider's lazy-load,
   * so the order you subscribe to `isLoading` vs the value store does not matter.
   */
  public isLoading: Writable<boolean>;

  /**
   * Svelte store that holds the last error thrown by `build()`, or `null`
   * when healthy. Subscribing activates the provider's lazy-load, matching
   * the behaviour of `isLoading`.
   */
  public error: Writable<any | null>;

  private store: Writable<T | null>;
  private reliesOn: (Provider<any, any, any> | Readable<any>)[];
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

  /**
   * When `true` the singleton instance is never evicted from the cache after
   * the last subscriber unsubscribes. Useful for providers that should stay
   * warm across page navigations.
   *
   * @default false
   */
  public keepAlive: boolean = false;
  private _pendingDelete: boolean = false;

  /**
   * Resolves to the current build's value once `build()` completes.
   * The same `Promise` instance is returned for the lifetime of a single build
   * cycle — accessing this getter multiple times is safe and cheap.
   * Rejects if `build()` throws.
   */
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

  /**
   * @param initial - Value emitted before the first `build()` completes.
   *                  Pass `null` if there is no meaningful initial value.
   * @param reliesOn - Zero or more provider instances whose resolved values
   *                   are forwarded to `build()` as positional arguments.
   *                   The provider re-runs whenever any dependency changes.
   */
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
          if (p instanceof Provider) {
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
          } else {
            // Plain Readable dep — mark dirty on every emission, including the
            // initial one, so the first subscriber triggers a build.
            this.unsubs.push(p.subscribe(() => this.markDirty()));
          }
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
      if (p instanceof Provider && p.isAncestorDirty()) {
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

  /**
   * Returns a callable factory that retrieves (or creates) the singleton
   * instance for a given set of constructor arguments.
   *
   * Call the returned factory with the same arguments as the constructor to
   * get the cached instance. Identical arguments always return the same object.
   *
   * @example
   * class PostProvider extends Provider<Post, [string]> { ... }
   * export const postProvider = PostProvider.create();
   *
   * postProvider('123') === postProvider('123') // true
   * postProvider('123') === postProvider('456') // false
   */
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
        if (p instanceof Provider) {
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
        } else {
          deps.push(get(p));
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

  /**
   * Directly sets the provider's value without triggering a `build()` re-run.
   * Useful for optimistic updates and action methods.
   *
   * Accepts a plain value or a `Promise`. If the promise rejects, the `error`
   * store is updated and the value store is set to `null`.
   *
   * @example
   * async addItem(item: CartItem) {
   *   await this.setState([...(get(this) ?? []), item]);
   * }
   */
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

  /**
   * Triggers a fresh `build()` and returns a promise that resolves to the new
   * value. Sets `isLoading` to `true` for the duration of the rebuild.
   *
   * @example
   * await postsProvider().invalidate();
   */
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

  /**
   * Override in subclasses to produce the provider's value.
   *
   * Called automatically on first subscriber and whenever a dependency
   * emits a new value. May return a `Promise<T>` for one-shot async work,
   * or a Svelte `Readable<T>` for streaming / live-updating values.
   *
   * Dependency values are injected as positional arguments in the order they
   * were passed to `super()`.
   */
  protected abstract build(
    ...deps: ExtractProviderValues<Deps>
  ): Promise<T> | Readable<T>;
}
