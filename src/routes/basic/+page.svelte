<script lang="ts">
  import { todosProvider } from '../../pods/todos.js';

  const todos   = todosProvider();
  const loading = todos.isLoading;
  const error   = todos.error;
</script>

<h1>Basic provider</h1>
<p class="subtitle">
  A <code>provider(fn)</code> runs its async function once and caches the
  resolved value. The same singleton is returned every time you call the factory.
</p>

<div class="card">
  {#if $loading}
    <span class="tag loading">loading…</span>
  {:else if $error}
    <span class="tag error">error: {$error.message}</span>
  {:else}
    <span class="tag ready">ready</span>
    <ul>
      {#each $todos ?? [] as todo}
        <li style="text-decoration: {todo.completed ? 'line-through' : 'none'}">
          {todo.title}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<details>
  <summary>pods/todos.ts</summary>
  <pre>{`import { provider } from 'svelteprovider';

export const todosProvider = provider(async (): Promise<Todo[]> => {
  const r = await fetch('/todos?_limit=5');
  if (!r.ok) throw new Error(\`HTTP \${r.status}\`);
  return r.json();
});`}</pre>
</details>
