<script lang="ts">
  import { QuoteProvider, quoteProvider } from '../../pods/quotes.js';

  const quotes  = quoteProvider();
  const loading = quotes.isLoading;
  const error   = quotes.error;

  async function showNext() {
    await (quotes as QuoteProvider).next();
  }
</script>

<h1>Class-based provider</h1>
<p class="subtitle">
  Extend <code>Provider&lt;T&gt;</code> when you need instance state, custom
  methods, or imperative control via <code>invalidate()</code>.
</p>

<div class="card">
  {#if $loading}
    <span class="tag loading">loading…</span>
    <p style="color:#999; font-style:italic">Fetching quote…</p>
  {:else if $error}
    <span class="tag error">{$error.message}</span>
  {:else}
    <span class="tag ready">ready</span>
    <blockquote style="margin: 0.5rem 0 1rem; font-size: 1.05rem">
      "{$quotes}"
    </blockquote>
  {/if}

  <button onclick={showNext} disabled={$loading}>Next quote →</button>
</div>

<details>
  <summary>pods/quotes.ts</summary>
  <pre>{`import { Provider } from 'svelteprovider';

export class QuoteProvider extends Provider<string> {
  private cursor = 0;

  constructor() { super(null); }

  protected build(): Promise<string> {
    return fetchQuote(this.cursor);
  }

  next() {
    this.cursor++;
    return this.invalidate(); // re-runs build()
  }
}

export const quoteProvider = QuoteProvider.create();`}</pre>
</details>
