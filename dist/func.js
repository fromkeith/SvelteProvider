import { Provider } from "./provider";
import {} from "svelte/store";
function attachActions(target, actions) {
    for (const [key, method] of Object.entries(actions)) {
        target[key] = method;
    }
}
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
export function provider(fnOrDepsOrObj, fnOrObj) {
    // Case 4: single object with build + optional actions
    if (typeof fnOrDepsOrObj === "object" && !Array.isArray(fnOrDepsOrObj)) {
        const { build, ...actions } = fnOrDepsOrObj;
        class FunctionalProvider extends Provider {
            constructor() {
                super(null);
            }
            build() {
                return build.call(this);
            }
        }
        attachActions(FunctionalProvider.prototype, actions);
        return FunctionalProvider.create();
    }
    // Case 1: just a build fn
    if (typeof fnOrDepsOrObj === "function") {
        const buildFn = fnOrDepsOrObj;
        class FunctionalProvider extends Provider {
            constructor() {
                super(null);
            }
            build() {
                return buildFn();
            }
        }
        return FunctionalProvider.create();
    }
    // Cases 2 & 3: deps array + (fn | object)
    const depFactories = fnOrDepsOrObj;
    if (typeof fnOrObj === "function") {
        // Case 2: deps + build fn
        const buildFn = fnOrObj;
        class FunctionalProviderWithDeps extends Provider {
            constructor() {
                super(null, ...depFactories.map((f) => f()));
            }
            build(...deps) {
                return buildFn(...deps);
            }
        }
        return FunctionalProviderWithDeps.create();
    }
    // Case 3: deps + { build, ...actions }
    const { build, ...actions } = fnOrObj;
    class FunctionalProviderWithDepsAndActions extends Provider {
        constructor() {
            super(null, ...depFactories.map((f) => f()));
        }
        build(...deps) {
            return build.call(this, ...deps);
        }
    }
    attachActions(FunctionalProviderWithDepsAndActions.prototype, actions);
    return FunctionalProviderWithDepsAndActions.create();
}
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
export function providerFamily(fn) {
    class FamilyProvider extends Provider {
        args;
        constructor(...args) {
            super(null);
            this.args = args;
        }
        build() {
            return fn(...this.args);
        }
    }
    return FamilyProvider.create();
}
