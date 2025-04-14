import { writable, get } from 'svelte/store';
import 'esm-env';
const log = import.meta.env.DEV ? console.log : () => { };
export class Provider {
    static providerName;
    subscribe;
    isLoading = writable(true);
    store;
    error = writable(null);
    reliesOn;
    unsubs = [];
    debounce;
    instanceKey = '';
    promiseImpl;
    initial;
    isDirty = false;
    doAbort = false;
    get promise() {
        return new Promise((resolve, reject) => {
            let unsub;
            let errorSub;
            unsub = this.subscribe((v) => {
                if (this.isAncestorDirty()) {
                    return;
                }
                if (v && v !== this.initial) {
                    if (unsub) {
                        unsub();
                        errorSub();
                    }
                    log('resolving promise');
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
                    log('rejecting promise');
                    reject(v);
                }
            });
        });
    }
    constructor(initial, ...reliesOn) {
        log('creating new');
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
                // Provider.instances.delete(this.instanceKey);
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
            }
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
            const val = await this.build(...deps);
            if (this.doAbort) {
                // we need to rebuild
                // we were invalidated while building
                return this.refreshImpl();
            }
            this.isDirty = false;
            this.store.set(val);
            return val;
        }
        catch (ex) {
            log(`failed to refresh ${this.instanceKey}`);
            this.isDirty = false;
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
