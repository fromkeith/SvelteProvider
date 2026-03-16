<nav>
  <a href="/">Home</a>
  <a href="/basic">Basic</a>
  <a href="/deps">Dependencies</a>
  <a href="/family">Family</a>
  <a href="/class">Class-based</a>
  <a href="/store">Store</a>
</nav>

<main>
  <slot />
</main>

<style>
  :global(body) {
    font-family: system-ui, sans-serif;
    margin: 0;
    background: #f8f9fa;
    color: #1a1a2e;
  }

  nav {
    display: flex;
    gap: 1rem;
    padding: 0.75rem 1.5rem;
    background: #1a1a2e;
    align-items: center;
  }

  nav a {
    color: #a8b2ff;
    text-decoration: none;
    font-size: 0.9rem;
  }

  nav a:hover {
    color: #fff;
  }

  main {
    max-width: 720px;
    margin: 2rem auto;
    padding: 0 1rem;
  }

  :global(h1) { margin: 0 0 0.25rem; }
  :global(.subtitle) { color: #666; margin: 0 0 2rem; font-size: 0.95rem; }

  :global(.card) {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1rem;
  }

  :global(.tag) {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.2em 0.6em;
    border-radius: 4px;
    margin-bottom: 0.75rem;
  }

  :global(.tag.loading) { background: #fff3cd; color: #856404; }
  :global(.tag.error)   { background: #f8d7da; color: #842029; }
  :global(.tag.ready)   { background: #d1e7dd; color: #0a3622; }

  :global(button) {
    padding: 0.4rem 1rem;
    border: 1px solid #1a1a2e;
    border-radius: 5px;
    background: #1a1a2e;
    color: #fff;
    cursor: pointer;
    font-size: 0.85rem;
  }

  :global(button:hover) { background: #2d2d50; }
  :global(button:disabled) { opacity: 0.5; cursor: default; }

  :global(pre) {
    background: #f4f4f8;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    font-size: 0.82rem;
    overflow: auto;
    margin: 0;
  }
</style>
