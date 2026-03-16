import { type Writable, type Readable, type Subscriber, type Unsubscriber } from "svelte/store";
/** Extracts the resolved value type `T` from a `Provider<T, ...>`. */
export type ExtractProviderValue<P> = P extends Provider<infer T, any, any> ? T : never;
/** Maps a tuple of Provider types to a tuple of their resolved value types. */
export type ExtractProviderValues<Deps extends Provider<any, any, any>[]> = {
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
export declare abstract class Provider<T, Args extends any[] = [], Deps extends Provider<any, any, any>[] = Provider<any, any, any>[]> implements Readable<T> {
    static providerName?: string;
    /** Svelte `Readable` subscribe — prefix with `$` in components. */
    subscribe: (run: Subscriber<any>) => Unsubscriber;
    private _isLoading;
    private _error;
    /**
     * Svelte store that is `true` while `build()` is in-flight.
     * Subscribing to this store also activates the provider's lazy-load,
     * so the order you subscribe to `isLoading` vs the value store does not matter.
     */
    isLoading: Writable<boolean>;
    /**
     * Svelte store that holds the last error thrown by `build()`, or `null`
     * when healthy. Subscribing activates the provider's lazy-load, matching
     * the behaviour of `isLoading`.
     */
    error: Writable<any | null>;
    private store;
    private reliesOn;
    private unsubs;
    private instanceKey;
    private promiseImpl?;
    private _cachedPromise?;
    private initial;
    private isDirty;
    private doAbort;
    private hasRun;
    private subSubscriber;
    /**
     * When `true` the singleton instance is never evicted from the cache after
     * the last subscriber unsubscribes. Useful for providers that should stay
     * warm across page navigations.
     *
     * @default false
     */
    keepAlive: boolean;
    private _pendingDelete;
    /**
     * Resolves to the current build's value once `build()` completes.
     * The same `Promise` instance is returned for the lifetime of a single build
     * cycle — accessing this getter multiple times is safe and cheap.
     * Rejects if `build()` throws.
     */
    get promise(): Promise<T>;
    /**
     * @param initial - Value emitted before the first `build()` completes.
     *                  Pass `null` if there is no meaningful initial value.
     * @param reliesOn - Zero or more provider instances whose resolved values
     *                   are forwarded to `build()` as positional arguments.
     *                   The provider re-runs whenever any dependency changes.
     */
    constructor(initial: T | null, ...reliesOn: Deps);
    private isAncestorDirty;
    private markDirty;
    private static queueForDelete;
    private static getInstance;
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
    static create<T, Args extends any[] = [], P extends Provider<T, Args, any> = Provider<T, Args, any>>(this: new (...args: Args) => P): (...args: Args) => P;
    private refresh;
    private refreshImpl;
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
    protected setState(newState: T | Promise<T>): Promise<void>;
    /**
     * Triggers a fresh `build()` and returns a promise that resolves to the new
     * value. Sets `isLoading` to `true` for the duration of the rebuild.
     *
     * @example
     * await postsProvider().invalidate();
     */
    invalidate(): Promise<T | null>;
    protected invalidateSelf(): Promise<T | null>;
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
    protected abstract build(...deps: ExtractProviderValues<Deps>): Promise<T> | Readable<T>;
}
