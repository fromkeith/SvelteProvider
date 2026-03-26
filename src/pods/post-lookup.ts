import { paramProvider, provider } from '$lib';
import type { Readable } from 'svelte/store';

export interface Post {
  id: number;
  title: string;
  body: string;
}

export const postProvider = paramProvider((id: Readable<number>) =>
  provider([id], (postId) =>
    fetch(`https://jsonplaceholder.typicode.com/posts/${postId}`).then(r => r.json()),
  ),
);
