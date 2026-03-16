# SvelteProvider

> A [Riverpod](https://riverpod.dev/docs/introduction/why_riverpod) (from Flutter) inspired state management library for Svelte.

SvelteProvider is a Svelte store with the annoying parts handled:

- Loading & error state is built in, no boilerplate
- Singletons shared across every component and page, lazy-loaded on first use
- Providers that depend on other providers re-fetch automatically when upstream data changes
- Automatic cleanup of instance when no longer used
- Bbusiness logic grouped together in pods, rather than scattered across components/pages

---

## Installation

```bash
npm install svelteprovider
```

---

## Quick start — functional API

The `provider()` factory is the simplest way to create a provider.

```ts
// lib/providers.ts
import { provider } from 'svelteprovider';

export const postsProvider = provider<Post[]>(async () => {
    const resp = await fetch('/api/posts');
    return resp.json() as Post[];
});
```

```svelte
<script lang="ts">
    import { postsProvider } from '$lib/providers';

    const posts = postsProvider();
    const isLoading = posts.isLoading;
    const error = posts.error;
</script>

{#if $isLoading}
    <p>Loading…</p>
{:else if $error}
    <p>Error: {$error.message}</p>
{:else}
    {#each $posts as post}
        <p>{post.title}</p>
    {/each}
{/if}
```

`isLoading`, `error`, and the provider itself are all Svelte stores — prefix with `$` to read their current value.

---

## Functional API with dependencies

Declare dependencies and consume their values in one place — no split between a constructor and a `build()` method.

```ts
import { provider } from 'svelteprovider';
import { accountProvider } from './account';

// `account` is typed as IAccount — inferred from accountProvider's type
export const userPostsProvider = provider(
    [accountProvider],
    async (account) => {
        const resp = await fetch(`/api/users/${account.id}/posts`);
        return resp.json() as Promise<Post[]>;
    },
);
```

When `accountProvider` emits a new value, `userPostsProvider` is automatically invalidated and re-fetched.

---

## Parameterised functional providers

Use `providerFamily` when the provider needs a runtime argument. Each unique argument combination gets its own cached instance.

```ts
import { providerFamily } from 'svelteprovider';

export const postProvider = providerFamily<Post>((postId: string) =>
    fetch(`/api/posts/${postId}`).then(r => r.json() as Promise<Post>),
);
```

```svelte
<script lang="ts">
    import { postProvider } from '$lib/providers';

    let { postId }: { postId: string } = $props();

    // $derived re-runs when postId changes, picking up the right cached instance
    const post = $derived(postProvider(postId));
</script>

{#if $post}
    <h1>{$post.title}</h1>
    <p>{$post.body}</p>
{/if}
```

---

## Side effects — actions

Pass an object with a `build` method and any number of action methods to colocate data fetching and mutations in one place. Each method has `this` automatically bound to the provider instance, giving access to `setState()`, `invalidate()`, `promise`, and `subscribe`.

```ts
// pods/cart.ts
import { provider } from 'svelteprovider';
import { get } from 'svelte/store';

export const cartProvider = provider({
    async build(): Promise<CartItem[]> {
        return fetchCart();
    },
    async addItem(item: CartItem) {
        const current = get(this) ?? [];
        await this.setState([...current, item]);
    },
    async removeItem(id: string) {
        const current = get(this) ?? [];
        await this.setState(current.filter(i => i.id !== id));
    },
    async refresh() {
        return this.invalidate();
    },
});
```

```svelte
<script lang="ts">
    import { cartProvider } from '../pods/cart.js';

    const cart = cartProvider();
</script>

{#each $cart ?? [] as item}
    <p>{item.name} <button onclick={() => cart.removeItem(item.id)}>×</button></p>
{/each}
<button onclick={() => cart.addItem({ id: '1', name: 'Widget' })}>Add item</button>
```

`setState()` accepts a plain value or a `Promise`. `get(this)` returns the current value synchronously from the svelte store, or `null` if the provider hasn't resolved yet.

---

## Actions with dependencies

Combine dependencies and actions in the same object. The `build` method receives the resolved dependency values as arguments.

```ts
import { provider } from 'svelteprovider';
import { accountProvider } from './account';
import { get } from 'svelte/store';

export const userPostsProvider = provider(
    [accountProvider],
    {
        async build(account: IAccount) {
            return fetch(`/api/users/${account.id}/posts`).then(r => r.json());
        },
        async refresh() {
            return this.invalidate();
        },
    },
);
```

---

## Invalidating a provider

Every provider exposes a public `invalidate()` — triggers a fresh `build()` and returns a promise that resolves to the new value.

```ts
await accountProvider().invalidate();
```

---

## Class-based API

For providers that need instance state or other advanced patterns, extend `Provider` directly.

### Basic provider

```ts
import { Provider } from 'svelteprovider';

class AccountProvider extends Provider<IAccount> {
    constructor() {
        super(null);        // initial value before build() runs
    }
    protected async build(): Promise<IAccount> {
        const resp = await fetch('/api/account', { headers: getAuthHeaders() });
        return resp.json();
    }
}

export const accountProvider = AccountProvider.create();
```

### Depending on another provider

Specify the `Deps` generic to get fully typed `build()` parameters.

```ts
class AccountIsOldPlanProvider extends Provider<boolean, [], [AccountProvider]> {
    constructor() {
        super(false, accountProvider());
    }
    // `account` is typed as IAccount — no any leaking through
    protected async build(account: IAccount): Promise<boolean> {
        return (account.plan?.products?.length ?? 0) > 0;
    }
}
```

### Parameterised class providers

Pass constructor arguments to scope the singleton cache. Each unique argument combination gets its own instance.

```ts
class PostProvider extends Provider<IPost, [string]> {
    constructor(private postId: string) {
        super(null);
    }
    protected async build(): Promise<IPost> {
        return fetch(`/api/posts/${this.postId}`).then(r => r.json());
    }
}

export const postProvider = PostProvider.create();
```

```svelte
<script lang="ts">
    let { postId }: { postId: string } = $props();
    const post = $derived(postProvider(postId));
</script>

{#if $post}<h1>{$post.title}</h1>{/if}
```

---

## Awaiting first load

`provider.promise` resolves once the first build completes. It returns the same `Promise` instance for the lifetime of a single build cycle.

```svelte
{#await posts.promise}
    <p>Loading…</p>
{:then value}
    {#each value as post}<p>{post.title}</p>{/each}
{:catch err}
    <p>Error: {err.message}</p>
{/await}
```

---

## Returning a Readable (streaming updates)

`build()` can return a `Readable` instead of a `Promise`. The provider forwards every emission as its own value, staying live as long as the store does.

```ts
import { providerFamily } from 'svelteprovider';
import { readable } from 'svelte/store';

// Streams live price updates for a given ticker symbol
export const priceProvider = providerFamily((ticker: string) =>
    readable(0, (set) => {
        const ws = new WebSocket(`wss://prices.example.com/${ticker}`);
        ws.onmessage = (e) => set(JSON.parse(e.data).price);
        return () => ws.close();
    }),
);
```

---

## Lazy loading and lifecycle

Providers load lazily on first subscriber. When the last subscriber leaves, cleanup is deferred by one microtask tick. If a new subscriber arrives within that tick — as happens during SvelteKit page navigation — the instance is reused and no re-fetch occurs. If nothing re-subscribes, the provider is destroyed and memory is freed.

To keep a provider alive indefinitely across all unsubscribes:

```ts
const p = myProvider();
p.keepAlive = true;
```

---

## Server-side rendering (SSR)

The library is SSR-safe — no browser globals are accessed at module evaluation time. You can import providers in SvelteKit `load` functions:

```ts
// +page.ts
import { postsProvider } from '$lib/providers';

export async function load() {
    return { posts: await postsProvider().promise };
}
```

---

## Organising providers — the pods convention

Define providers in plain `.ts` modules (called "pods") outside your component files. This keeps providers reusable, testable, and easy to discover.

```
src/
  pods/
    user.ts          ← userProvider, userPostsProvider
    posts.ts         ← postProvider (providerFamily)
  routes/
    +page.svelte     ← imports from pods, calls the factory
```

```ts
// src/pods/user.ts
import { provider } from 'svelteprovider';

export const userProvider = provider(async () => fetchCurrentUser());
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { userProvider } from '../pods/user.js';
  const user = userProvider();
</script>
```

---

## Todo

- [ ] Server-side testing
- [ ] Graceful error propagation from parent to child providers
