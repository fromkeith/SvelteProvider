import { provider } from "$lib";

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Post {
  id: number;
  title: string;
}

export const userProvider = provider(async (): Promise<User> => {
  const r = await fetch("https://jsonplaceholder.typicode.com/users/1");
  return r.json();
});

// Declares userProvider as a dependency — the resolved User is injected as the
// first argument. This provider won't run until userProvider resolves, and it
// re-runs automatically whenever userProvider produces a new value.
export const userPostsProvider = provider(
  [userProvider],
  async (user: User): Promise<Post[]> => {
    const r = await fetch(
      `https://jsonplaceholder.typicode.com/posts?userId=${user.id}&_limit=4`,
    );
    return r.json();
  },
);
