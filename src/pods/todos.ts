import { provider } from "$lib";

export interface Todo {
  id: number;
  title: string;
  completed: boolean;
}

export const todosProvider = provider<Todo[]>(async () => {
  const r = await fetch("https://jsonplaceholder.typicode.com/todos?_limit=5");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
});
