import { providerFamily } from '$lib';

export interface Post {
  id: number;
  title: string;
  body: string;
}

// One cached Provider instance per unique id — postProvider(1) === postProvider(1)
// but postProvider(1) !== postProvider(2).
export const postProvider = providerFamily(async (id: number): Promise<Post> => {
  const r = await fetch(`https://jsonplaceholder.typicode.com/posts/${id}`);
  return r.json();
});
