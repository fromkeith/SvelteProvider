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

# Lazy load

Everything is lazy loaded, taking advantage of Svelte Stores
first subscriber functionality.

# Parameterized loading

We can have loaders with parameterized initialization.
Here we take two parameters, one of type string, the other number.

```
class AccountIsOldPlanProvider extends Provider<boolean, [string, number]> {
    constructor(hello: string, world: number) {
        // we can now access hello + world!
        super(false, accountProvider());
    }
    protected async build(account: IAccountAccount): Promise<boolean> {
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