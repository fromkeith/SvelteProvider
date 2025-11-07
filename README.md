# SvelteProvider

> A [Riverpod](https://riverpod.dev/docs/introduction/why_riverpod) (from flutter) inspired wrapper around stores


# Usage

Create a provider by extending the provider class

```
class AccountProvider extends Provider<IAccountAccount> {
    constructor() {
        // this is our default value before build is called
        super(null);
    }
    // this is how we pull the data
    protected async build(): Promise<IAccountAccount> {
        const resp = await fetch(`${PUBLIC_API_DOMAIN}/v1/account/?prefs=yes`, {
            method: 'GET',
            headers: getAuthHeaders(),
        });
        const account: IAccountAccount = await resp.json();
        return account;
    }
}
// this is a singleton of our provider that can be used by anyone
export const accountProvider = AccountProvider.create();
```

Then to use the provider

```
import {accountProvider} from '$lib/stores';
// you now have a Svelte store!
// any udpates to the provider will update the store too
$: account = accountProvider();

// we can check loading state
$: isLoading = account.isLoading
// await a promise for first load
await account.promise
// or just get current value
get(account)
// we can get any errors as a store as well
$: error = account.error



// or in the UI as
{#if !$isLoading}
    {$account}
{/if}
{#if $error}
    {$error}
{/if}
{#await account.promise}
{/if}
```

# Depending on anther Provider

You might want to make 1 provider manipulate the results of another.
This can be done, and have it react to changes in the parent.

```
class AccountIsOldPlanProvider extends Provider<boolean> {
    // if using minification, you need to set `providerName`
    public static providerName: string = 'AccountIsOldPlanProvider';
    constructor() {
        super(false, accountProvider());
    }
    protected async build(account: IAccountAccount): Promise<boolean> {
        if ((account.plan?.products?.length ?? 0) > 0) {
            return true
        }
        return false;
    }
}
```


# Parameterized loading

We can have loaders with parameterized initialization.
Here we take two parameters, one of type string, the other number.

```
class AccountIsOldPlanProvider extends Provider<boolean, [string, number]> {
    private hello: string;
    private world: number;
    constructor(hello: string, world: number) {
        // we can now access hello + world!
        super(false, accountProvider());
        this.hello = hello;
        this.world = world;
    }
    protected async build(account: IAccountAccount): Promise<boolean> {
        console.log(this.hello, this.world);
        if ((account.plan?.products?.length ?? 0) > 0) {
            return true
        }
        return false;
    }
}
const accountIsOldPlanProvider = AccountIsOldPlanProvider.create();
```

Usage of that
```
import {accountIsOldPlanProvider} from '$lib/stores';

$: accountIsOld = accountIsOldPlanProvider("this", 123);
```

## Side effects

Add in member functions
```
// either call "invalidateSelf" to trigger a refresh
public setAuth(token: string): Promise<IAuthPayload | null> {
    self.localStorage.authToken = token;
    return this.invalidateSelf();
}

// or call "setState" to set a promise directyl
public logout() {
    self.localStorage.removeItem('authToken');
    this.setState(Promise.resolve(null));
}
```


# Using Stores

Instead of a Promise, you can return a Readable, allowing you to stream updates from a store.

```
import { type Readable} from 'svelte/store';
class AccountIsOldPlanProvider extends Provider<boolean> {
    // if using minification, you need to set `providerName`
    public static providerName: string = 'AccountIsOldPlanProvider';
    constructor() {
        super(false, accountProvider());
    }
    protected async build(account: IAccountAccount): Readable<boolean> {
        return writer(false, (set) => {
            // got subscriber
            setTimeout(() => {
              set(true);
            }, 1000);
            return () => {
              // no longer subbed
            };
        });
    }
}
```


# Lazy load

Everything is lazy loaded, taking advantage of Svelte Stores
first subscriber functionality. Stores are automatically destroyed when no longer subscribed to.
To prevent this, you can use the `keepAlive` option.


# Quirks

- If you watch `$isLoading` in the html before the `$provider` itself.. it may never load as its not being subscribed to.

eg.
```
$: provider = myProvider();
$: isLoading = provider.isLoading;

// this may cause issues as $provider might not get subbed to
{#if $isLoading && $provider}
    <div>Loading...</div>
{/if}
```


- Look out for minification issues, read above.


# Todo/Unknowns

- [ ] No server side testing done
- [ ] Allow pods to be self deleted when no one listening
- [ ] Add examples
- [ ] Allow graceful error handling, so if a parent fails, the child can catch it
- [ ] Better cleanup on page navigation
