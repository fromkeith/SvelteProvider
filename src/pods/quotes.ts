import { Provider } from '$lib';

const QUOTES = [
  'Simplicity is the ultimate sophistication. — da Vinci',
  'Programs must be written for people to read. — Abelson',
  'The best code is no code at all. — Atwood',
  'Make it work, make it right, make it fast. — Beck',
  'Perfection is achieved when there is nothing left to remove. — Saint-Exupéry',
];

// Class-based syntax is useful when you need instance state or custom methods
// that go beyond what the functional API provides.
export class QuoteProvider extends Provider<string> {
  private cursor = 0;

  constructor() {
    super(null);
  }

  protected build(): Promise<string> {
    return new Promise((resolve) =>
      setTimeout(() => resolve(QUOTES[this.cursor % QUOTES.length]), 400),
    );
  }

  // Custom method: advance the cursor then re-run build()
  next(): Promise<string | null> {
    this.cursor++;
    return this.invalidate();
  }
}

export const quoteProvider = QuoteProvider.create();
