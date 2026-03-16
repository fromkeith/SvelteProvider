// Minification-safe class identity via a numeric counter assigned at runtime.
let _classIdCounter = 0;
export function getClassId(cls) {
    if (!Object.prototype.hasOwnProperty.call(cls, "__providerId")) {
        cls.__providerId = ++_classIdCounter;
    }
    return cls.__providerId;
}
