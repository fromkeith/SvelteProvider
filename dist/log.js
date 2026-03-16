// SSR-safe debug logging — never reference window at module evaluation time
export const log = typeof window !== "undefined" && window.debug
    ? console.log
    : () => { };
