<h1>SvelteProvider Examples</h1>
<p class="subtitle">Riverpod-style reactive providers for Svelte.</p>

<div class="card">
  <strong>provider(fn)</strong> — async or store-returning function, no deps
  <br /><a href="/basic">→ Basic example</a>
</div>

<div class="card">
  <strong>provider([deps], fn)</strong> — re-runs whenever a dependency resolves
  <br /><a href="/deps">→ Dependencies example</a>
</div>

<div class="card">
  <strong>paramProvider(factory)</strong> — reactive parameter, single provider reruns on change
  <br /><a href="/family">→ paramProvider example</a>
</div>

<div class="card">
  <strong>class extends Provider</strong> — class-based API with <code>invalidate()</code>
  <br /><a href="/class">→ Class-based example</a>
</div>

<div class="card">
  <strong>build() → Readable</strong> — wrap any Svelte store so other providers can depend on it
  <br /><a href="/store">→ Store example</a>
</div>
