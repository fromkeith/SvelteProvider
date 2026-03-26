<script lang="ts">
  import { postProvider } from '../../pods/post-lookup.js';

  let selectedId = $state(1);

  const post    = $derived(postProvider(selectedId));
  const loading = $derived(post.isLoading);
  const error   = $derived(post.error);
</script>

<h1>paramProvider</h1>
<p class="subtitle">
  Like <code>provider()</code> but with a reactive parameter. Changing the
  selected ID updates the internal store, causing the provider to re-fetch
  automatically.
</p>

<div class="card">
  <label>
    Select a post ID:&ensp;
    <select bind:value={selectedId}>
      {#each [1, 2, 3] as id}
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
      <span class="tag ready">ready</span>
      <h3 style="margin: 0.5rem 0 0.25rem">{$post?.title}</h3>
      <p style="margin:0; color:#555; font-size:0.9rem">{$post?.body}</p>
    {/if}
  </div>
</div>

<details>
  <summary>pods/post-lookup.ts</summary>
  <pre>{`import { paramProvider, provider } from 'svelteprovider';
import type { Readable } from 'svelte/store';

export const postProvider = paramProvider((id: Readable<number>) =>
  provider([id], (postId) =>
    fetch(\`/posts/\${postId}\`).then(r => r.json()),
  ),
);`}</pre>
</details>
