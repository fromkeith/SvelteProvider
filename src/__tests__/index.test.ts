import { describe, it, expect, vi } from "vitest";
import { writable, get } from "svelte/store";
import { Provider, provider, paramProvider } from "../lib/index.js";
import type { Readable } from "svelte/store";

vi.mock("../lib/log.js", () => ({ log: console.log }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all values emitted by a store, returning them and an unsub fn. */
function collect<T>(store: { subscribe: (run: (v: T) => void) => () => void }) {
  const values: T[] = [];
  const unsub = store.subscribe((v) => values.push(v));
  return { values, unsub };
}

// ---------------------------------------------------------------------------
// provider() — no deps
// ---------------------------------------------------------------------------

describe("provider() — no deps", () => {
  it("resolves to the returned value", async () => {
    const p = provider(async () => 42);
    expect(await p().promise).toBe(42);
  });

  it("isLoading starts true then becomes false", async () => {
    const p = provider(async () => "hello");
    const instance = p();
    const { values, unsub } = collect(instance.isLoading);
    await instance.promise;
    unsub();
    expect(values[0]).toBe(true);
    expect(values[values.length - 1]).toBe(false);
  });

  it("emits the resolved value through subscribe", async () => {
    const p = provider(async () => 99);
    const instance = p();
    const { values, unsub } = collect<number | null>(instance);
    await instance.promise;
    unsub();
    expect(values).toContain(99);
  });

  it("sets error store and rejects promise on throw", async () => {
    const err = new Error("boom");
    const p = provider(async () => {
      throw err;
    });
    const instance = p();

    await expect(instance.promise).rejects.toThrow("boom");

    let errorValue: unknown;
    const unsub = instance.error.subscribe((v) => (errorValue = v));
    unsub();
    expect(errorValue).toBe(err);
  });

  it("returns same singleton instance per factory call", () => {
    const p = provider(async () => 1);
    expect(p()).toBe(p());
  });

  it("works with a synchronously-completing Readable", async () => {
    const store = writable(7);
    const p = provider(() => store);
    expect(await p().promise).toBe(7);
  });

  it("forwards subsequent store emissions", async () => {
    const store = writable(1);
    const p = provider(() => store);
    const instance = p();
    const { values, unsub } = collect<number | null>(instance);
    await instance.promise;
    store.set(2);
    store.set(3);
    unsub();
    expect(values).toContain(1);
    expect(values).toContain(2);
    expect(values).toContain(3);
  });

  it("dependent re-runs with each new store emission, not the initial value", async () => {
    const store = writable(1);
    const sourceP = provider(() => store);
    const derivedP = provider([sourceP], async (n: number) => n * 10);

    const derived = derivedP();
    const { values, unsub } = collect<number | null>(derived);

    await derived.promise;
    store.set(2);
    await derived.promise;
    store.set(3);
    await derived.promise;

    unsub();
    expect(values).toContain(10);
    expect(values).toContain(20);
    expect(values).toContain(30);
  });
});

// ---------------------------------------------------------------------------
// provider() — with deps
// ---------------------------------------------------------------------------

describe("provider() — with deps", () => {
  it("receives the resolved dep value", async () => {
    const depP = provider(async () => 10);
    const mainP = provider([depP], async (dep: number) => dep * 2);
    expect(await mainP().promise).toBe(20);
  });

  it("re-runs when dep invalidates", async () => {
    let depVal = 1;
    const depP = provider(async () => depVal);
    const mainP = provider([depP], async (dep: number) => dep + 100);

    const main = mainP();
    // Keep a subscriber alive so main's dep-subscriptions are not torn down.
    const { values, unsub } = collect<number | null>(main);

    await main.promise;
    expect(values).toContain(101);

    depVal = 5;
    await depP().invalidate();
    await main.promise;

    unsub();
    expect(values).toContain(105);
  });

  it("error in dep propagates to dependent", async () => {
    const err = new Error("dep failed");
    const depP = provider(async () => {
      throw err;
    });
    const mainP = provider([depP], async (dep: number) => dep);

    await expect(mainP().promise).rejects.toThrow("dep failed");
  });
});

// ---------------------------------------------------------------------------
// paramProvider()
// ---------------------------------------------------------------------------

describe("paramProvider()", () => {
  it("resolves with the correct initial value", async () => {
    const pp = paramProvider((id: Readable<number>) =>
      provider([id], (n) => Promise.resolve(n * 3)),
    );
    expect(await pp(5).promise).toBe(15);
  });

  it("always returns the same singleton instance regardless of arg", () => {
    const pp = paramProvider((id: Readable<number>) =>
      provider([id], (n) => Promise.resolve(n)),
    );
    expect(pp(1)).toBe(pp(2));
  });

  it("reruns when called with a new arg value", async () => {
    const pp = paramProvider((id: Readable<number>) =>
      provider([id], (n) => Promise.resolve(n * 10)),
    );
    const instance = pp(1);
    const { values, unsub } = collect<number | null>(instance);
    await instance.promise;
    expect(values).toContain(10);

    pp(2);
    await instance.promise;
    unsub();
    expect(values).toContain(20);
  });

  it("supports multiple args", async () => {
    const pp = paramProvider((a: Readable<number>, b: Readable<number>) =>
      provider([a, b], (x, y) => Promise.resolve(x + y)),
    );
    expect(await pp(3, 4).promise).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Class-based Provider
// ---------------------------------------------------------------------------

describe("class-based Provider", () => {
  it("build() result is used as the value", async () => {
    class GreetProvider extends Provider<string> {
      constructor() {
        super(null);
      }
      protected build() {
        return Promise.resolve("hello");
      }
    }
    const factory = GreetProvider.create();
    expect(await factory().promise).toBe("hello");
  });

  it("create() returns a singleton factory", () => {
    class NumProvider extends Provider<number> {
      constructor() {
        super(null);
      }
      protected build() {
        return Promise.resolve(1);
      }
    }
    const factory = NumProvider.create();
    expect(factory()).toBe(factory());
  });

  it("keepAlive=true keeps the instance alive after unsubscribe", async () => {
    class KeptProvider extends Provider<number> {
      constructor() {
        super(null);
      }
      protected build() {
        return Promise.resolve(42);
      }
    }
    const factory = KeptProvider.create();
    const instance = factory();
    instance.keepAlive = true;

    const unsub = instance.subscribe(() => {});
    await instance.promise;
    unsub();

    // Instance should still be in the singleton cache
    expect(factory()).toBe(instance);
  });
});

// ---------------------------------------------------------------------------
// Bug: provider resolves to null
// ---------------------------------------------------------------------------

describe("null resolution", () => {
  it("resolves promise and clears isLoading when build returns null", async () => {
    const p = provider(async (): Promise<null> => null);
    const instance = p();

    // Should resolve without hanging
    const val = await instance.promise;
    expect(val).toBeNull();

    let loading: boolean | undefined;
    const unsub = instance.isLoading.subscribe((v) => (loading = v));
    unsub();
    expect(loading).toBe(false);
  });

  it("resolves correctly after invalidation when result is null both times", async () => {
    let callCount = 0;
    const p = provider(async (): Promise<null> => {
      callCount++;
      return null;
    });
    const instance = p();
    const { values, unsub } = collect<null>(instance);

    await instance.promise;
    expect(callCount).toBe(1);

    await instance.invalidate();
    expect(callCount).toBe(2);

    unsub();
    // Both resolutions should have notified subscribers
    expect(values.filter((v) => v === null).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Bug: page navigation causes re-fetch
// ---------------------------------------------------------------------------

describe("navigation re-subscription", () => {
  it("reuses the cached instance when re-subscribed in the same microtask tick", async () => {
    let buildCount = 0;
    const p = provider(async () => {
      buildCount++;
      return 42;
    });

    const instance1 = p();
    const { unsub } = collect(instance1);
    await instance1.promise;
    expect(buildCount).toBe(1);

    // Simulate old page unloading
    unsub();

    // Simulate new page loading — p() called again before the deferred
    // deletion microtask has had a chance to run
    const instance2 = p();
    expect(instance2).toBe(instance1); // same cached instance

    const { values, unsub: unsub2 } = collect(instance2);
    expect(buildCount).toBe(1); // no re-fetch
    expect(values[0]).toBe(42); // value served immediately

    unsub2();
  });

  it("creates a fresh instance once the deletion microtask has run", async () => {
    const p = provider(async () => "hello");

    const instance1 = p();
    const { unsub } = collect(instance1);
    await instance1.promise;

    unsub();

    // Yield past the deletion microtask
    await Promise.resolve();

    const instance2 = p();
    expect(instance2).not.toBe(instance1);
  });
});

// ---------------------------------------------------------------------------
// setState() — side effects from outside the class
// ---------------------------------------------------------------------------

describe("setState()", () => {
  it("pushes a value directly without triggering a rebuild", async () => {
    let buildCount = 0;
    const p = provider({
      async build() {
        buildCount++;
        return "initial";
      },
      override() {
        return this.setState(Promise.resolve("overridden"));
      },
    });
    const instance = p();
    await instance.promise;
    expect(buildCount).toBe(1);

    await instance.override();
    expect(buildCount).toBe(1); // no rebuild

    let val: string | null = null;
    const unsub = instance.subscribe((v) => (val = v));
    unsub();
    expect(val).toBe("overridden");
  });

  it("accepts a plain value (not a promise)", async () => {
    const p = provider({
      async build() {
        return "initial";
      },
      direct() {
        this.setState("direct");
      },
    });
    const instance = p();
    await instance.promise;

    await instance.direct();

    let val: string | null = null;
    const unsub = instance.subscribe((v) => (val = v));
    unsub();
    expect(val).toBe("direct");
  });

  it("sets the error store when the promise rejects", async () => {
    const p = provider({
      async build() {
        return "ok";
      },
      async reject() {
        await this.setState(Promise.reject(err)).catch(() => {});
      },
    });
    const instance = p();
    await instance.promise;

    const err = new Error("forced");
    await instance.reject();

    let errorVal: unknown;
    const unsub = instance.error.subscribe((v) => (errorVal = v));
    unsub();
    expect(errorVal).toBe(err);
  });
});

// ---------------------------------------------------------------------------
// provider() with actions
// ---------------------------------------------------------------------------

describe("provider() with actions", () => {
  it("attaches action methods to the instance", async () => {
    const p = provider({
      async build() {
        return 0;
      },
      increment() {
        const cur = get(this) ?? 0;
        return this.setState(cur + 1);
      },
    });
    const instance = p() as any;
    await instance.promise;

    await instance.increment();
    expect(get(instance)).toBe(1);

    await instance.increment();
    expect(get(instance)).toBe(2);
  });

  it("action this context has access to getState and setState", async () => {
    const p = provider({
      async build() {
        return { count: 0 };
      },
      async reset() {
        await this.setState({ count: 0 });
      },
      async add(n: number) {
        const cur = await this.promise;
        console.log("got", cur, n);
        await this.setState({ count: cur.count + n });
      },
    });
    const instance = p() as any;
    await instance.promise;

    await instance.add(5);
    expect(await instance.promise).toEqual({ count: 5 });

    await instance.add(3);
    expect(await instance.promise).toEqual({ count: 8 });

    await instance.reset();
    expect(await instance.promise).toEqual({ count: 0 });
  });

  it("returns the same singleton with actions attached", () => {
    const p = provider({
      async build() {
        return 0;
      },
      bump() {
        return this.setState((get(this) ?? 0) + 1);
      },
    });
    expect(p()).toBe(p());
    expect(typeof (p() as any).bump).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// invalidate()
// ---------------------------------------------------------------------------

describe("invalidate()", () => {
  it("triggers a rebuild and returns the new value", async () => {
    let count = 0;
    const p = provider(async () => ++count);
    const instance = p();

    await instance.promise; // count = 1
    const newVal = await instance.invalidate(); // count = 2
    expect(newVal).toBe(2);
  });

  it("isLoading becomes true again during rebuild", async () => {
    const p = provider(async () => 1);
    const instance = p();
    await instance.promise;

    const loadingSnap: boolean[] = [];
    const unsub = instance.isLoading.subscribe((v) => loadingSnap.push(v));
    await instance.invalidate();
    unsub();

    expect(loadingSnap).toContain(true);
    expect(loadingSnap[loadingSnap.length - 1]).toBe(false);
  });
});
