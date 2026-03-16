<script lang="ts">
  import { postProvider } from '../../pods/post-lookup.js';

  const ids = [1, 2, 3];
  // Pre-warm a few instances so the cache effect is visible when switching
  ids.forEach((id) => postProvider(id));

  let selectedId = $state(1);

  const post    = $derived(postProvider(selectedId));
  const loading = $derived(post.isLoading);
  const error   = $derived(post.error);
</script>

<h1>providerFamily</h1>
<p class="subtitle">
  Like <code>provider()</code> but parameterised. Each unique argument
  combination gets its own cached singleton — switch back to a previously
  selected ID and the result is instant.
</p>

<div class="card">
  <label>
    Select a post ID:&ensp;
    <select bind:value={selectedId}>
      {#each ids as id}
        <option value={id}>Post {id}</option>
      {/each}
    </select>
  </label>

  <div style="margin-top: 1rem">
    {#if $loading}
      <span class="tag loading">loading…</span>
    {:else if $error}
      <span class="tag error">{$error.message}</span>
    {:else}
      <span class="tag ready">ready (cached)</span>
      <h3 style="margin: 0.5rem 0 0.25rem">{$post?.title}</h3>
      <p style="margin:0; color:#555; font-size:0.9rem">{$post?.body}</p>
    {/if}
  </div>
</div>

<details>
  <summary>pods/post-lookup.ts</summary>
  <pre>{`import { providerFamily } from 'svelteprovider';

export const postProvider = providerFamily(async (id: number) => {
  const r = await fetch(\`/posts/\${id}\`);
  return r.json();
});

// postProvider(1) === postProvider(1)  ✓ same instance
// postProvider(1) !== postProvider(2)  ✓ separate cache`}</pre>
</details>
