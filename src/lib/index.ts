import {
  writable,
  get,
  derived,
  type Writable,
  type Readable,
  type Subscriber,
  type Unsubscriber,
} from "svelte/store";

const log = (window as any).debug ? console.log : () => {};

export abstract class Provider<T, Args extends any[] = []>
  implements Readable<T>
{
  public static providerName: string;

  public subscribe: (run: Subscriber<any>) => Unsubscriber;
  public isLoading: Writable<boolean> = writable(true);
  private store: Writable<T | null>;
  public error: Writable<any | null> = writable(null);
  private reliesOn: Provider<any, any[]>[];
  private unsubs: Unsubscriber[] = [];
  private debounce: any;
  private instanceKey: string = "";
  private promiseImpl?: Promise<T | null>;
  private initial: T | null;
  private isDirty: boolean = false;
  private doAbort: boolean = false;
  private hasRun: boolean = false;
  private subSubscriber: Unsubscriber | undefined;
  public keepAlive: boolean = false;

  public get promise(): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let unsub: Unsubscriber;
      let errorSub: Unsubscriber;
      unsub = this.subscribe((v: T) => {
        if (this.isAncestorDirty()) {
          return;
        }
        if (this.hasRun) {
          if (unsub) {
            unsub();
            errorSub();
          }
          log("resolving promise");
          resolve(v);
          return;
        }
      });
      errorSub = this.error.subscribe((v) => {
        if (this.isAncestorDirty()) {
          return;
        }
        if (v) {
          if (errorSub) {
            errorSub();
            unsub();
          }
          log("rejecting promise");
          reject(v);
        }
      });
    });
  }

  constructor(initial: T | null, ...reliesOn: Provider<any, any[]>[]) {
    log("creating new");
    this.initial = initial;
    this.reliesOn = reliesOn;
    let isInitial = true;
    this.store = writable(initial, () => {
      log(`writable first ${isInitial} ${this.instanceKey}`);
      if (isInitial && this.reliesOn.length === 0) {
        this.markDirty();
      }
      isInitial = false;
      for (const p of this.reliesOn) {
        const k = p;
        this.unsubs.push(
          p.subscribe(() => {
            if (k.isDirty) {
              return; // ignore update
            }
            log(`${k.instanceKey} updated, so ${this.instanceKey} is dirty`);
            this.markDirty();
          }),
        );
        this.unsubs.push(
          p.error.subscribe(() => {
            if (k.isDirty) {
              return; // ignore update
            }
            log(`${k.instanceKey} failed, so ${this.instanceKey} is dirty`);
            this.markDirty();
          }),
        );
      }

      return () => {
        log(`writable ended ${this.instanceKey}`);
        // unsub from dependancies
        for (const u of this.unsubs) {
          u();
        }
        this.unsubs = [];
        // remove myself from the instances
        if (!this.keepAlive) {
          Provider.queueForDelete(this);
        }
      };
    });
    this.subscribe = (run: Subscriber<any>) => {
      log(`subscribe to ${this.instanceKey}`);
      return this.store.subscribe(run);
    };
  }

  private isAncestorDirty() {
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

  private markDirty() {
    if (!this.isDirty) {
      this.isLoading.set(true);
      this.isDirty = true;
      this.doAbort = false;
      this.promiseImpl = undefined;
      queueMicrotask(() => {
        if (this.isDirty) {
          this.refresh();
        }
      });
    } else if (this.promiseImpl) {
      // actively resfreshing
      // so we need to retry or abort
      this.doAbort = true;
    }
  }

  // shared across all providers
  private static instances = new Map<string, any>();

  private static queueForDelete(provider: Provider<any, any>) {
    // TODO: on page nav, we will lose providers
    // unless keep alive is on
    Provider.instances.delete(provider.instanceKey);
  }

  private static getInstance<T, Args extends any[]>(
    this: new (...args: Args) => Provider<T, Args>,
    ...args: Args
  ): Provider<T, Args> {
    // prepend key with name of the class
    // if using minification, better to use `providerName`
    const name = (this as any).providerName ?? this.name;
    const key = `${name};${JSON.stringify(args)}`;
    log(`getInstance ${key}`);
    if (!Provider.instances.has(key)) {
      log(`--createInstance ${key}`);
      const newProvider = new this(...args);
      newProvider.instanceKey = key;
      Provider.instances.set(key, newProvider);
    }
    return Provider.instances.get(key);
  }

  static create<
    T,
    Args extends any[] = [],
    P extends Provider<T, Args> = Provider<T, Args>,
  >(this: new (...args: Args) => P): (...args: Args) => P {
    return new Proxy(this, {
      apply(target: any, thisArg: any, args: unknown[]) {
        return target.getInstance(...args);
      },
    }) as (...args: Args) => P;
  }

  private async refresh(): Promise<T | null> {
    this.isLoading.set(true);
    this.error.set(null);

    this.promiseImpl = this.refreshImpl();
    return this.promiseImpl;
  }
  private async refreshImpl(): Promise<T | null> {
    this.doAbort = false;
    this.subSubscriber?.();
    this.subSubscriber = undefined;
    log(`resfreshing ${this.instanceKey}`);
    try {
      let deps: any[] = [];
      for (const p of this.reliesOn) {
        if (this.doAbort) {
          this.refreshImpl();
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
        // we need to rebuild
        // we were invalidated while building
        return this.refreshImpl();
      }
      const buildResult = this.build(...deps);
      // if not readable
      if (!(buildResult as Readable<T>).subscribe) {
        const val = await (buildResult as Promise<T>);
        if (this.doAbort) {
          // we need to rebuild
          // we were invalidated while building
          return this.refreshImpl();
        }
        this.isDirty = false;
        this.hasRun = true;
        this.store.set(val);
        return val;
      }
      // its returning a store, so subscribe to that
      // and return our first value for backwards compatibility
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
          this.store.set(val);
        });
      });
    } catch (ex: any) {
      log(`failed to refresh ${this.instanceKey}`);
      this.isDirty = false;
      this.hasRun = true;
      this.error.set(ex);
      this.store.set(null);
      return Promise.reject(ex);
    } finally {
      this.isLoading.set(false);
    }
  }

  protected async setState(newState: Promise<T>) {
    this.promiseImpl = newState;
    try {
      const val = await this.promiseImpl;
      this.store.set(val);
    } catch (ex: any) {
      this.error.set(ex);
      this.store.set(null);
    }
  }
  protected invalidateSelf(): Promise<T | null> {
    log(`invalidat: ${this.instanceKey}`);
    this.promiseImpl = undefined;
    this.store.set(null);
    this.error.set(null);
    this.isLoading.set(true);
    this.markDirty();
    return this.promise;
  }

  protected abstract build(...deps: any): Promise<T> | Readable<T>;
}
