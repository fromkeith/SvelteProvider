import { Provider, type ExtractProviderValues } from "./provider";
import { type Readable } from "svelte/store";
type AnyProvider = Provider<any, any, any>;
type ActionThis<T> = {
    setState(newState: T | Promise<T>): Promise<void>;
    invalidate(): Promise<T | null>;
    readonly promise: Promise<T>;
    subscribe: Readable<T>["subscribe"];
};
type ActionMap = Record<string, (...args: any[]) => any>;
type BuildAndActions<T, DepValues extends any[] = []> = {
    build(...args: DepValues): Promise<T> | Readable<T>;
} & ActionMap;
/**
 * Creates a provider from a plain async function or a function returning a
 * Svelte `Readable`.
 *
 * @example
 * const postsProvider = provider(async () => fetchPosts());
 */
export declare function provider<T>(fn: () => Promise<T> | Readable<T>): () => Provider<T, [], []>;
/**
 * Creates a provider that depends on other providers. The resolved values of
 * each dependency are forwarded as positional arguments to `fn`. The provider
 * is automatically invalidated whenever a dependency emits a new value.
 *
 * @example
 * const userPostsProvider = provider(
 *   [accountProvider],
 *   async (account) => fetchPostsFor(account.id),
 * );
 */
export declare function provider<T, Deps extends AnyProvider[]>(deps: {
    [K in keyof Deps]: () => Deps[K];
}, fn: (...args: ExtractProviderValues<Deps>) => Promise<T> | Readable<T>): () => Provider<T, [], Deps>;
/**
 * Creates a provider with dependencies and co-located actions. The `build`
 * method receives the resolved dependency values as arguments. Action methods
 * have `this` automatically bound to the provider instance.
 *
 * @example
 * const userPostsProvider = provider(
 *   [accountProvider],
 *   {
 *     async build(account) { return fetchPostsFor(account.id); },
 *     async refresh() { return this.invalidate(); },
 *   },
 * );
 */
export declare function provider<T, Deps extends AnyProvider[], A extends ActionMap>(deps: {
    [K in keyof Deps]: () => Deps[K];
}, obj: BuildAndActions<T, ExtractProviderValues<Deps>> & A & ThisType<ActionThis<T>>): () => Provider<T, [], Deps> & Omit<A, "build">;
/**
 * Creates a provider from an object with a `build` method and optional action
 * methods. All methods have `this` automatically bound to the provider
 * instance, giving access to `setState()`, `invalidate()`, `promise`, and
 * `subscribe` without any explicit `this` annotation.
 *
 * @example
 * const cartProvider = provider({
 *   async build(): Promise<CartItem[]> { return fetchCart(); },
 *   async addItem(item: CartItem) {
 *     await this.setState([...(get(this) ?? []), item]);
 *   },
 *   async refresh() { return this.invalidate(); },
 * });
 */
export declare function provider<T, A extends ActionMap>(obj: BuildAndActions<T> & A & ThisType<ActionThis<T>>): () => Provider<T, [], []> & Omit<A, "build">;
/**
 * Creates a parameterised provider. Each unique combination of arguments gets
 * its own cached singleton instance — identical to the class-based
 * `Provider.create()` pattern but without the boilerplate.
 *
 * @example
 * const postProvider = providerFamily((postId: string) =>
 *   fetch(`/api/posts/${postId}`).then(r => r.json()),
 * );
 *
 * // In a component:
 * const post = $derived(postProvider(postId));
 */
export declare function providerFamily<T, Args extends any[]>(fn: (...args: Args) => Promise<T> | Readable<T>): (...args: Args) => Provider<T, Args, []>;
export {};
