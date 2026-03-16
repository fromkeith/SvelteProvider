import { Provider, type ExtractProviderValues } from "./provider";
import { type Readable } from "svelte/store";

type AnyProvider = Provider<any, any, any>;

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

// 1. Just build fn
export function provider<T>(
  fn: () => Promise<T> | Readable<T>,
): () => Provider<T, [], []>;

// 2. Deps + build fn
export function provider<T, Deps extends AnyProvider[]>(
  deps: { [K in keyof Deps]: () => Deps[K] },
  fn: (...args: ExtractProviderValues<Deps>) => Promise<T> | Readable<T>,
): () => Provider<T, [], Deps>;

// 3. Deps + { build, ...actions }
export function provider<T, Deps extends AnyProvider[], A extends ActionMap>(
  deps: { [K in keyof Deps]: () => Deps[K] },
  obj: BuildAndActions<T, ExtractProviderValues<Deps>> &
    A &
    ThisType<ActionThis<T>>,
): () => Provider<T, [], Deps> & Omit<A, "build">;

// 4. { build, ...actions }
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
  const depFactories = fnOrDepsOrObj as (() => AnyProvider)[];

  if (typeof fnOrObj === "function") {
    // Case 2: deps + build fn
    const buildFn = fnOrObj;
    class FunctionalProviderWithDeps extends Provider<T> {
      constructor() {
        super(null, ...depFactories.map((f) => f()));
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
      super(null, ...depFactories.map((f) => f()));
    }
    protected build(...deps: any[]): Promise<T> | Readable<T> {
      return build.call(this, ...deps);
    }
  }
  attachActions(FunctionalProviderWithDepsAndActions.prototype, actions);
  return FunctionalProviderWithDepsAndActions.create();
}

/**
 * Creates a parameterised functional provider. Each unique combination of
 * arguments gets its own cached singleton instance, exactly like the
 * class-based `Provider.create()` pattern.
 *
 * @example
 * export const postProvider = providerFamily((postId: string) =>
 *   fetch(`/api/posts/${postId}`).then(r => r.json()),
 * );
 *
 * // In a component:
 * const post = $derived(postProvider(postId));
 */
export function providerFamily<T, Args extends any[]>(
  fn: (...args: Args) => Promise<T> | Readable<T>,
): (...args: Args) => Provider<T, Args, []> {
  class FamilyProvider extends Provider<T, Args, []> {
    private readonly args: Args;
    constructor(...args: Args) {
      super(null);
      this.args = args;
    }
    protected build(): Promise<T> | Readable<T> {
      return fn(...this.args);
    }
  }
  return FamilyProvider.create();
}
