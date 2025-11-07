import { writable, get, derived, } from "svelte/store";
const log = window.debug ? console.log : () => { };
export class Provider {
    static providerName;
    subscribe;
    isLoading = writable(true);
    store;
    error = writable(null);
    reliesOn;
    unsubs = [];
    debounce;
    instanceKey = "";
    promiseImpl;
    initial;
    isDirty = false;
    doAbort = false;
    hasRun = false;
    subSubscriber;
    keepAlive = false;
    get promise() {
        return new Promise((resolve, reject) => {
            let unsub;
            let errorSub;
            unsub = this.subscribe((v) => {
                if (this.isAncestorDirty()) {
                    return;
                }
                if (this.hasRun) {
                    if (unsub) {
                        unsub();
                        errorSub();
                    }
                    log("resolving promise");
                    resolve(v);
                    return;
                }
            });
            errorSub = this.error.subscribe((v) => {
                if (this.isAncestorDirty()) {
                    return;
                }
                if (v) {
                    if (errorSub) {
                        errorSub();
                        unsub();
                    }
                    log("rejecting promise");
                    reject(v);
                }
            });
        });
    }
    constructor(initial, ...reliesOn) {
        log("creating new");
        this.initial = initial;
        this.reliesOn = reliesOn;
        let isInitial = true;
        this.store = writable(initial, () => {
            log(`writable first ${isInitial} ${this.instanceKey}`);
            if (isInitial && this.reliesOn.length === 0) {
                this.markDirty();
            }
            isInitial = false;
            for (const p of this.reliesOn) {
                const k = p;
                this.unsubs.push(p.subscribe(() => {
                    if (k.isDirty) {
                        return; // ignore update
                    }
                    log(`${k.instanceKey} updated, so ${this.instanceKey} is dirty`);
                    this.markDirty();
                }));
                this.unsubs.push(p.error.subscribe(() => {
                    if (k.isDirty) {
                        return; // ignore update
                    }
                    log(`${k.instanceKey} failed, so ${this.instanceKey} is dirty`);
                    this.markDirty();
                }));
            }
            return () => {
                log(`writable ended ${this.instanceKey}`);
                // unsub from dependancies
                for (const u of this.unsubs) {
                    u();
                }
                this.unsubs = [];
                // remove myself from the instances
                if (!this.keepAlive) {
                    Provider.queueForDelete(this);
                }
            };
        });
        this.subscribe = (run) => {
            log(`subscribe to ${this.instanceKey}`);
            return this.store.subscribe(run);
        };
    }
    isAncestorDirty() {
        if (this.isDirty) {
            return true;
        }
        for (const p of this.reliesOn) {
            if (p.isAncestorDirty()) {
                return true;
            }
        }
        return false;
    }
    markDirty() {
        if (!this.isDirty) {
            this.isLoading.set(true);
            this.isDirty = true;
            this.doAbort = false;
            this.promiseImpl = undefined;
            queueMicrotask(() => {
                if (this.isDirty) {
                    this.refresh();
                }
            });
        }
        else if (this.promiseImpl) {
            // actively resfreshing
            // so we need to retry or abort
            this.doAbort = true;
        }
    }
    // shared across all providers
    static instances = new Map();
    static queueForDelete(provider) {
        // TODO: on page nav, we will lose providers
        // unless keep alive is on
        Provider.instances.delete(provider.instanceKey);
    }
    static getInstance(...args) {
        // prepend key with name of the class
        // if using minification, better to use `providerName`
        const name = this.providerName ?? this.name;
        const key = `${name};${JSON.stringify(args)}`;
        log(`getInstance ${key}`);
        if (!Provider.instances.has(key)) {
            log(`--createInstance ${key}`);
            const newProvider = new this(...args);
            newProvider.instanceKey = key;
            Provider.instances.set(key, newProvider);
        }
        return Provider.instances.get(key);
    }
    static create() {
        return new Proxy(this, {
            apply(target, thisArg, args) {
                return target.getInstance(...args);
            },
        });
    }
    async refresh() {
        this.isLoading.set(true);
        this.error.set(null);
        this.promiseImpl = this.refreshImpl();
        return this.promiseImpl;
    }
    async refreshImpl() {
        this.doAbort = false;
        this.subSubscriber?.();
        this.subSubscriber = undefined;
        log(`resfreshing ${this.instanceKey}`);
        try {
            let deps = [];
            for (const p of this.reliesOn) {
                if (this.doAbort) {
                    this.refreshImpl();
                }
                if (p.promiseImpl != undefined) {
                    log(`--wait other: ${this.instanceKey} asking for ${p.instanceKey}'s promise`);
                    deps.push(await p.promiseImpl);
                }
                else {
                    log(`--refresh other: ${this.instanceKey} asking for ${p.instanceKey}`);
                    deps.push(await p.promise);
                }
            }
            if (this.doAbort) {
                // we need to rebuild
                // we were invalidated while building
                return this.refreshImpl();
            }
            const buildResult = this.build(...deps);
            // if not readable
            if (!buildResult.subscribe) {
                const val = await buildResult;
                if (this.doAbort) {
                    // we need to rebuild
                    // we were invalidated while building
                    return this.refreshImpl();
                }
                this.isDirty = false;
                this.hasRun = true;
                this.store.set(val);
                return val;
            }
            // its returning a store, so subscribe to that
            // and return our first value for backwards compatibility
            const asStore = buildResult;
            let hasGotValue = false;
            return new Promise((resolve) => {
                this.subSubscriber = asStore.subscribe((val) => {
                    if (!hasGotValue) {
                        this.isDirty = false;
                        this.hasRun = true;
                        hasGotValue = true;
                        resolve(val);
                    }
                    this.store.set(val);
                });
            });
        }
        catch (ex) {
            log(`failed to refresh ${this.instanceKey}`);
            this.isDirty = false;
            this.hasRun = true;
            this.error.set(ex);
            this.store.set(null);
            return Promise.reject(ex);
        }
        finally {
            this.isLoading.set(false);
        }
    }
    async setState(newState) {
        this.promiseImpl = newState;
        try {
            const val = await this.promiseImpl;
            this.store.set(val);
        }
        catch (ex) {
            this.error.set(ex);
            this.store.set(null);
        }
    }
    invalidateSelf() {
        log(`invalidat: ${this.instanceKey}`);
        this.promiseImpl = undefined;
        this.store.set(null);
        this.error.set(null);
        this.isLoading.set(true);
        this.markDirty();
        return this.promise;
    }
}
