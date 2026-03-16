// SSR-safe debug logging — never reference window at module evaluation time
export const log: (...args: any[]) => void =
  typeof window !== "undefined" && (window as any).debug
    ? console.log
    : () => {};
