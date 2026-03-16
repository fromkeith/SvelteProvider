import { writable, } from "svelte/store";
import { log } from "./log";
import { UNSET } from "./sentinel";
import { getClassId } from "./utils";
// Shared across all providers
const instances = new Map();
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
export class Provider {
    // providerName is kept for backwards compatibility but no longer required
    static providerName;
    /** Svelte `Readable` subscribe — prefix with `$` in components. */
    subscribe;
    // Internal writable stores - set only by the Provider internals
    _isLoading;
    _error;
    /**
     * Svelte store that is `true` while `build()` is in-flight.
     * Subscribing to this store also activates the provider's lazy-load,
     * so the order you subscribe to `isLoading` vs the value store does not matter.
     */
    isLoading;
    /**
     * Svelte store that holds the last error thrown by `build()`, or `null`
     * when healthy. Subscribing activates the provider's lazy-load, matching
     * the behaviour of `isLoading`.
     */
    error;
    store;
    reliesOn;
    unsubs = [];
    instanceKey = "";
    promiseImpl;
    // Cached public promise - cleared in markDirty() so each build cycle
    // produces exactly one Promise instance regardless of how many times the
    // getter is accessed.
    _cachedPromise;
    initial;
    isDirty = false;
    doAbort = false;
    hasRun = false;
    subSubscriber;
    /**
     * When `true` the singleton instance is never evicted from the cache after
     * the last subscriber unsubscribes. Useful for providers that should stay
     * warm across page navigations.
     *
     * @default false
     */
    keepAlive = false;
    _pendingDelete = false;
    /**
     * Resolves to the current build's value once `build()` completes.
     * The same `Promise` instance is returned for the lifetime of a single build
     * cycle — accessing this getter multiple times is safe and cheap.
     * Rejects if `build()` throws.
     */
    get promise() {
        if (!this._cachedPromise) {
            this._cachedPromise = new Promise((resolve, reject) => {
                let unsub;
                let errorSub;
                unsub = this.subscribe((v) => {
                    if (this.isAncestorDirty())
                        return;
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
                    if (this.isAncestorDirty())
                        return;
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
    constructor(initial, ...reliesOn) {
        log("creating new");
        this.initial = initial;
        this.reliesOn = reliesOn;
        let isInitial = true;
        this._isLoading = writable(true);
        this._error = writable(null);
        // Start the store with UNSET (not null) so that store.set(null) always
        // fires a notification - even when the provider legitimately resolves to null.
        this.store = writable((initial === null ? UNSET : initial), () => {
            // Cancel any deferred deletion queued from the previous stop.
            this._pendingDelete = false;
            log(`writable first ${isInitial} ${this.instanceKey}`);
            if (isInitial && this.reliesOn.length === 0) {
                this.markDirty();
            }
            isInitial = false;
            for (const p of this.reliesOn) {
                const k = p;
                this.unsubs.push(p.subscribe(() => {
                    if (k.isDirty)
                        return;
                    log(`${k.instanceKey} updated, so ${this.instanceKey} is dirty`);
                    this.markDirty();
                }));
                // Subscribe to the internal _error store to avoid a recursive
                // activation loop through the public error wrapper.
                this.unsubs.push(p._error.subscribe(() => {
                    if (k.isDirty)
                        return;
                    log(`${k.instanceKey} failed, so ${this.instanceKey} is dirty`);
                    this.markDirty();
                }));
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
        });
        // isLoading - subscribing triggers the main store's lazy-load notifier.
        this.isLoading = {
            subscribe: (run) => {
                const mainUnsub = this.store.subscribe(() => { });
                const sub = this._isLoading.subscribe(run);
                return () => {
                    mainUnsub();
                    sub();
                };
            },
            set: (v) => this._isLoading.set(v),
            update: (fn) => this._isLoading.update(fn),
        };
        // error - same treatment as isLoading.
        this.error = {
            subscribe: (run) => {
                const mainUnsub = this.store.subscribe(() => { });
                const sub = this._error.subscribe(run);
                return () => {
                    mainUnsub();
                    sub();
                };
            },
            set: (v) => this._error.set(v),
            update: (fn) => this._error.update(fn),
        };
        this.subscribe = (run) => {
            log(`subscribe to ${this.instanceKey}`);
            // Translate the internal UNSET sentinel to null for external subscribers.
            return this.store.subscribe((v) => run(v === UNSET ? null : v));
        };
    }
    isAncestorDirty() {
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
    markDirty() {
        // Invalidate cached promise so the next access creates a fresh one
        this._cachedPromise = undefined;
        if (!this.isDirty) {
            this._isLoading.set(true);
            this.isDirty = true;
            this.doAbort = false;
            this.promiseImpl = undefined;
            queueMicrotask(() => {
                if (this.isDirty) {
                    this.refresh().catch(() => { });
                }
            });
        }
        else if (this.promiseImpl) {
            // Actively refreshing - signal that we need to restart
            this.doAbort = true;
        }
    }
    static queueForDelete(provider) {
        instances.delete(provider.instanceKey);
    }
    static getInstance(...args) {
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
    static create() {
        return new Proxy(this, {
            apply(target, _thisArg, args) {
                return target.getInstance(...args);
            },
        });
    }
    async refresh() {
        this._isLoading.set(true);
        this._error.set(null);
        this.promiseImpl = this.refreshImpl();
        // Attach a no-op catch so that a rejected promiseImpl is never an
        // unhandled rejection when no dependent is currently awaiting it.
        this.promiseImpl.catch(() => { });
        return this.promiseImpl;
    }
    async refreshImpl() {
        this.doAbort = false;
        this.subSubscriber?.();
        this.subSubscriber = undefined;
        log(`refreshing ${this.instanceKey}`);
        try {
            const deps = [];
            for (const p of this.reliesOn) {
                if (this.doAbort) {
                    return this.refreshImpl();
                }
                if (p.promiseImpl != undefined) {
                    log(`--wait other: ${this.instanceKey} asking for ${p.instanceKey}'s promise`);
                    deps.push(await p.promiseImpl);
                }
                else {
                    log(`--refresh other: ${this.instanceKey} asking for ${p.instanceKey}`);
                    deps.push(await p.promise);
                }
            }
            if (this.doAbort) {
                return this.refreshImpl();
            }
            const buildResult = this.build(...deps);
            if (!buildResult.subscribe) {
                const val = await buildResult;
                if (this.doAbort) {
                    return this.refreshImpl();
                }
                this.isDirty = false;
                this.hasRun = true;
                this.store.set(val);
                return val;
            }
            // build() returned a Readable - subscribe and forward values
            const asStore = buildResult;
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
        }
        catch (ex) {
            log(`failed to refresh ${this.instanceKey}`);
            this.isDirty = false;
            this.hasRun = true;
            this._error.set(ex);
            this.store.set(null);
            return Promise.reject(ex);
        }
        finally {
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
    async setState(newState) {
        const p = newState instanceof Promise ? newState : Promise.resolve(newState);
        this.promiseImpl = p;
        this._cachedPromise = undefined;
        try {
            const val = await this.promiseImpl;
            this.store.set(val);
        }
        catch (ex) {
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
    invalidate() {
        return this.invalidateSelf();
    }
    invalidateSelf() {
        log(`invalidate: ${this.instanceKey}`);
        this.promiseImpl = undefined;
        // Reset to UNSET (not null) so that a subsequent store.set(null) is always
        // a real change and subscribers are notified even when the result is null.
        this.store.set(UNSET);
        this._error.set(null);
        this._isLoading.set(true);
        this.markDirty();
        return this.promise;
    }
}
