<script lang="ts">
  import { elapsed, elapsedProvider, doubledProvider } from '../../pods/timer.js';
  import { onDestroy } from 'svelte';

  // The store lives in the pod; the component owns the interval lifecycle.
  const interval = setInterval(() => elapsed.update((n) => n + 1), 1000);
  onDestroy(() => clearInterval(interval));

  const tick    = elapsedProvider();
  const doubled = doubledProvider();

  const tickLoading    = tick.isLoading;
  const doubledLoading = doubled.isLoading;
</script>

<h1>Readable store as build() return value</h1>
<p class="subtitle">
  When <code>build()</code> returns a Svelte <code>Readable</code>, the provider
  re-emits every value it produces. Other providers can declare it as a dependency
  and will re-run on each new emission.
</p>

<div class="card" style="display:grid; grid-template-columns:1fr 1fr; gap:1rem">
  <div>
    <strong>elapsedProvider</strong>
    <br /><small>wraps a writable store</small>
    <p style="font-size: 2rem; margin: 0.5rem 0 0">
      {#if $tickLoading}…{:else}{$tick}s{/if}
    </p>
  </div>

  <div>
    <strong>doubledProvider</strong>
    <br /><small>depends on elapsedProvider</small>
    <p style="font-size: 2rem; margin: 0.5rem 0 0">
      {#if $doubledLoading}…{:else}{$doubled}s{/if}
    </p>
  </div>
</div>

<details>
  <summary>pods/timer.ts</summary>
  <pre>{`import { provider } from 'svelteprovider';
import { writable } from 'svelte/store';

export const elapsed = writable(0);

export const elapsedProvider = provider(() => elapsed);

export const doubledProvider = provider(
  [elapsedProvider],
  async (secs) => secs * 2,
);`}</pre>
</details>
