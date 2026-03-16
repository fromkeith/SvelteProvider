<script lang="ts">
  import { userProvider, userPostsProvider } from '../../pods/user-posts.js';

  const user  = userProvider();
  const posts = userPostsProvider();

  const userLoading  = user.isLoading;
  const postsLoading = posts.isLoading;
  const postsError   = posts.error;
</script>

<h1>Provider dependencies</h1>
<p class="subtitle">
  Pass an array of provider factories as the first argument. Their resolved
  values are forwarded to your function in order — just like Riverpod's <code>ref.watch</code>.
</p>

<div class="card" style="display:grid; grid-template-columns:1fr 1fr; gap:1rem">
  <div>
    <strong>User</strong>
    {#if $userLoading}
      <p class="tag loading">loading…</p>
    {:else}
      <p>{$user?.name}<br /><small>{$user?.email}</small></p>
    {/if}
  </div>

  <div>
    <strong>Posts (depends on user)</strong>
    {#if $postsLoading}
      <p class="tag loading">waiting for user…</p>
    {:else if $postsError}
      <p class="tag error">{$postsError.message}</p>
    {:else}
      <ul style="margin:0; padding-left:1.2rem">
        {#each $posts ?? [] as post}
          <li>{post.title}</li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<details>
  <summary>pods/user-posts.ts</summary>
  <pre>{`import { provider } from 'svelteprovider';

export const userProvider = provider(async () => fetchUser(1));

export const userPostsProvider = provider(
  [userProvider],           // ← dependency list
  async (user) => fetchPosts(user.id),
);`}</pre>
</details>
