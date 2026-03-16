import { provider } from '$lib';
import { writable } from 'svelte/store';

// The store is exported so components can drive it (e.g. start/stop a timer)
// while providers can depend on it as a reactive source.
export const elapsed = writable(0);

// Wrapping the store in a provider lets other providers declare it as a
// dependency — they'll re-run automatically on every emission.
export const elapsedProvider = provider(() => elapsed);

export const doubledProvider = provider(
  [elapsedProvider],
  async (secs: number) => secs * 2,
);
