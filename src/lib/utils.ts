// Minification-safe class identity via a numeric counter assigned at runtime.
let _classIdCounter = 0;
export function getClassId(cls: Function): number {
  if (!Object.prototype.hasOwnProperty.call(cls, "__providerId")) {
    (cls as any).__providerId = ++_classIdCounter;
  }
  return (cls as any).__providerId;
}
