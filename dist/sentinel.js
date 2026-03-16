// Sentinel used as the internal store value while a provider hasn't yet
// produced a result. Using a symbol instead of null means that store.set(null)
// is always a real change (null !== UNSET), so Svelte notifies subscribers even
// when the provider legitimately resolves to null.
export const UNSET = Symbol("svele-provider-unset");
