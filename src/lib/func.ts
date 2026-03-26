import { Provider, type ExtractProviderValues } from "./provider";
import { writable, type Readable, type Writable } from "svelte/store";
import { untrack } from "svelte";

type AnyProvider = Provider<any, any, any>;
type AnyDep = AnyProvider | Readable<any>;

// Maps a dep array item to its expected input form:
//   Provider dep  → () => Provider  (factory, existing behaviour)
//   Readable dep  → Readable        (passed directly)
type DepInput<D extends AnyDep> = D extends AnyProvider ? () => D : D;

// The `this` context available inside build and action methods.
// Deliberately narrower than Provider so setState can stay protected on the class.
type ActionThis<T> = {
  setState(newState: T | Promise<T>): Promise<void>;
  invalidate(): Promise<T | null>;
  readonly promise: Promise<T>;
  subscribe: Readable<T>["subscribe"];
};

// Plain action methods (no build). `this` is contextually typed via ThisType below.
type ActionMap = Record<string, (...args: any[]) => any>;

// Object form: build method + optional action methods.
type BuildAndActions<T, DepValues extends any[] = []> = {
  build(...args: DepValues): Promise<T> | Readable<T>;
} & ActionMap;

function attachActions(target: any, actions: ActionMap) {
  for (const [key, method] of Object.entries(actions)) {
    target[key] = method;
  }
}

// ---------------------------------------------------------------------------
// Overloads
// ---------------------------------------------------------------------------

/**
 * Creates a provider from a plain async function or a function returning a
 * Svelte `Readable`.
 *
 * @example
 * const postsProvider = provider(async () => fetchPosts());
 */
export function provider<T>(
  fn: () => Promise<T> | Readable<T>,
): () => Provider<T, [], []>;

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
export function provider<T, Deps extends AnyDep[]>(
  deps: { [K in keyof Deps]: DepInput<Deps[K]> },
  fn: (...args: ExtractProviderValues<Deps>) => Promise<T> | Readable<T>,
): () => Provider<T, [], Deps>;

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
export function provider<T, Deps extends AnyDep[], A extends ActionMap>(
  deps: { [K in keyof Deps]: DepInput<Deps[K]> },
  obj: BuildAndActions<T, ExtractProviderValues<Deps>> &
    A &
    ThisType<ActionThis<T>>,
): () => Provider<T, [], Deps> & Omit<A, "build">;

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
export function provider<T, A extends ActionMap>(
  obj: BuildAndActions<T> & A & ThisType<ActionThis<T>>,
): () => Provider<T, [], []> & Omit<A, "build">;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function provider<T>(
  fnOrDepsOrObj:
    | (() => Promise<T> | Readable<T>)
    | (() => AnyProvider)[]
    | (BuildAndActions<T> & ActionMap),
  fnOrObj?:
    | ((...args: any[]) => Promise<T> | Readable<T>)
    | (BuildAndActions<T, any[]> & ActionMap),
): () => AnyProvider {
  // Case 4: single object with build + optional actions
  if (typeof fnOrDepsOrObj === "object" && !Array.isArray(fnOrDepsOrObj)) {
    const { build, ...actions } = fnOrDepsOrObj;
    class FunctionalProvider extends Provider<T, [], []> {
      constructor() {
        super(null);
      }
      protected build(): Promise<T> | Readable<T> {
        return build.call(this);
      }
    }
    attachActions(FunctionalProvider.prototype, actions);
    return FunctionalProvider.create();
  }

  // Case 1: just a build fn
  if (typeof fnOrDepsOrObj === "function") {
    const buildFn = fnOrDepsOrObj;
    class FunctionalProvider extends Provider<T, [], []> {
      constructor() {
        super(null);
      }
      protected build(): Promise<T> | Readable<T> {
        return buildFn();
      }
    }
    return FunctionalProvider.create();
  }

  // Cases 2 & 3: deps array + (fn | object)
  const rawDeps = fnOrDepsOrObj as ((() => AnyProvider) | Readable<any>)[];
  const resolveDeps = () => rawDeps.map((d) => (typeof d === "function" ? d() : d));

  if (typeof fnOrObj === "function") {
    // Case 2: deps + build fn
    const buildFn = fnOrObj;
    class FunctionalProviderWithDeps extends Provider<T> {
      constructor() {
        super(null, ...resolveDeps());
      }
      protected build(...deps: any[]): Promise<T> | Readable<T> {
        return buildFn(...deps);
      }
    }
    return FunctionalProviderWithDeps.create();
  }

  // Case 3: deps + { build, ...actions }
  const { build, ...actions } = fnOrObj as BuildAndActions<T, any[]> & ActionMap;
  class FunctionalProviderWithDepsAndActions extends Provider<T> {
    constructor() {
      super(null, ...resolveDeps());
    }
    protected build(...deps: any[]): Promise<T> | Readable<T> {
      return build.call(this, ...deps);
    }
  }
  attachActions(FunctionalProviderWithDepsAndActions.prototype, actions);
  return FunctionalProviderWithDepsAndActions.create();
}


/**
 * Creates a singleton provider whose inputs are reactive. The factory receives
 * each parameter as a `Readable<T>` so it can be passed directly as a dep.
 * Calling the returned function again with new values updates the internal
 * stores, causing the provider to re-run automatically.
 *
 * @example
 * // In a module:
 * export const postProvider = paramProvider((postId: Readable<string>) =>
 *   provider([postId], (id) => fetch(`/api/posts/${id}`).then(r => r.json())),
 * );
 *
 * // In a component:
 * let { postId } = $props();
 * const post = $derived(postProvider(postId));
 */
export function paramProvider<T, Args extends any[]>(
  factory: (...params: { [K in keyof Args]: Readable<Args[K]> }) => () => Provider<T>,
): (...args: Args) => Provider<T> {
  let instance: Provider<T> | null = null;
  const stores: Writable<any>[] = [];

  return (...args: Args): Provider<T> => {
    if (!instance) {
      const readables = args.map((arg) => {
        const s = writable(arg);
        stores.push(s);
        return s as Readable<any>;
      });
      instance = factory(...(readables as unknown as { [K in keyof Args]: Readable<Args[K]> }))();
    } else {
      untrack(() => args.forEach((arg, i) => stores[i].set(arg)));
    }
    return instance;
  };
}
