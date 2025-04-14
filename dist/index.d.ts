import { type Writable, type Readable, type Subscriber, type Unsubscriber } from 'svelte/store';
import 'esm-env';
export declare abstract class Provider<T, Args extends any[] = []> implements Readable<T> {
    static providerName: string;
    subscribe: (run: Subscriber<any>) => Unsubscriber;
    isLoading: Writable<boolean>;
    private store;
    error: Writable<any | null>;
    private reliesOn;
    private unsubs;
    private debounce;
    private instanceKey;
    private promiseImpl?;
    private initial;
    private isDirty;
    private doAbort;
    get promise(): Promise<T>;
    constructor(initial: T | null, ...reliesOn: Provider<any, any[]>[]);
    private isAncestorDirty;
    private markDirty;
    private static instances;
    private static getInstance;
    static create<T, Args extends any[] = [], P extends Provider<T, Args> = Provider<T, Args>>(this: new (...args: Args) => P): (...args: Args) => P;
    private refresh;
    private refreshImpl;
    protected setState(newState: Promise<T>): Promise<void>;
    protected invalidateSelf(): Promise<T | null>;
    protected abstract build(...deps: any): Promise<T>;
}
