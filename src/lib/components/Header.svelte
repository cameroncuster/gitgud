<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { currentActor, signInWithGithub, signOut } from '$lib/auth/currentActor';

  let mobileMenuOpen = false;
  let mobileMenuButton: HTMLButtonElement | null = null;
  let loginBusy = false;
  let loginError = page.url.pathname === '/' && page.url.searchParams.get('auth_error') === 'true';
  let logoutBusy = false;
  let logoutError = false;

  $: user = $currentActor.user;
  $: username = user
    ? user.user_metadata?.user_name ||
      user.user_metadata?.preferred_username ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'User'
    : '';
  $: githubUrl = user ? user.user_metadata?.html_url || `https://github.com/${username}` : '';

  const navigation = [
    { href: '/', label: 'Problems' },
    { href: '/contests', label: 'Contests' },
    { href: '/leaderboard', label: 'Leaderboard' },
    { href: '/about', label: 'About' }
  ] as const;

  async function handleLogin(): Promise<void> {
    if (loginBusy) return;
    loginBusy = true;
    loginError = false;
    try {
      await signInWithGithub();
      mobileMenuOpen = false;
    } catch {
      loginBusy = false;
      loginError = true;
    }
  }

  async function handleLogout(): Promise<void> {
    if (logoutBusy) return;
    logoutBusy = true;
    logoutError = false;
    try {
      await signOut();
      mobileMenuOpen = false;
    } catch {
      logoutError = true;
    } finally {
      logoutBusy = false;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !mobileMenuOpen) return;
    mobileMenuOpen = false;
    mobileMenuButton?.focus();
  }

  afterNavigate(() => {
    mobileMenuOpen = false;
    loginError = page.url.pathname === '/' && page.url.searchParams.get('auth_error') === 'true';
  });
</script>

<svelte:window on:keydown={handleWindowKeydown} />

<header
  class="sticky top-0 z-50 w-full border-b border-[var(--color-border)] bg-[var(--color-secondary)] py-3"
>
  <div class="mx-auto flex max-w-[1200px] items-center justify-between px-3 sm:px-4 md:px-5">
    <a
      href={resolve('/')}
      aria-label="Home"
      class="flex items-center gap-2 pr-2 text-xl font-bold text-[var(--color-heading)] no-underline lg:pr-4"
    >
      <img src="/favicon.png" alt="" class="h-12 w-12 object-contain" />
      <span class="flex font-bold tracking-wide">
        <span class="text-[var(--color-accent)]">gitgud</span><span
          class="hidden text-[var(--color-heading)] sm:inline">.cc</span
        >
      </span>
    </a>

    <button
      bind:this={mobileMenuButton}
      class="flex min-h-11 min-w-11 items-center justify-center rounded-md border-2 border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-tertiary)] lg:hidden"
      aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
      aria-expanded={mobileMenuOpen}
      aria-controls="mobile-menu"
      on:click={() => (mobileMenuOpen = !mobileMenuOpen)}
    >
      <span aria-hidden="true">{mobileMenuOpen ? '×' : '☰'}</span>
    </button>

    <nav class="hidden items-center gap-4 lg:flex" aria-label="Primary navigation">
      <ul class="m-0 flex list-none items-center gap-3 p-0 xl:gap-4">
        {#each navigation as item (item.href)}
          <li class="relative">
            <a
              href={resolve(item.href)}
              aria-current={page.url.pathname === item.href ? 'page' : undefined}
              class="block py-2 text-sm font-bold text-[var(--color-heading)] no-underline hover:text-[var(--color-accent)] lg:text-base {page
                .url.pathname === item.href
                ? 'border-b-2 border-[var(--color-accent)]'
                : ''}">{item.label}</a
            >
          </li>
        {/each}
        {#if user && $currentActor.isAdmin}
          <li>
            <a
              href={resolve('/submit')}
              class="block py-2 text-base font-bold text-[var(--color-heading)] hover:text-[var(--color-accent)]"
              >Submit</a
            >
          </li>
        {/if}
      </ul>

      <div class="flex min-w-44 items-center justify-end gap-3">
        {#if !$currentActor.initialized}
          <button
            type="button"
            disabled
            class="rounded border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)]"
            aria-label="Checking session">Checking session…</button
          >
        {:else if user}
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer external"
            class="text-sm font-medium text-[var(--color-username)]">@{username}</a
          >
          <a
            href={resolve('/settings')}
            class="flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--color-text)] hover:bg-[var(--color-tertiary)] hover:text-[var(--color-accent)]"
            title="Settings"
            aria-label="Settings"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              class="h-5 w-5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              ></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </a>
          <button
            class="rounded border border-[var(--color-border)] px-3 py-2 text-sm font-bold disabled:cursor-wait disabled:opacity-70"
            on:click={handleLogout}
            disabled={logoutBusy}
            aria-busy={logoutBusy}>{logoutBusy ? 'Signing out…' : 'Logout'}</button
          >
        {:else}
          <a
            href={resolve('/settings')}
            class="flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--color-text)] hover:bg-[var(--color-tertiary)] hover:text-[var(--color-accent)]"
            title="Settings"
            aria-label="Settings"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              class="h-5 w-5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              ></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </a>
          <div>
            <button
              type="button"
              class="rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-2 text-sm font-bold text-[var(--color-on-accent)] disabled:cursor-wait disabled:opacity-70"
              on:click={handleLogin}
              disabled={loginBusy}
              aria-busy={loginBusy}
            >
              {#if loginBusy}<span
                  class="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden="true"
                ></span>{/if}
              {loginBusy ? 'Opening GitHub…' : 'Sign in'}
            </button>
            {#if loginError}
              <p class="mt-1 max-w-48 text-xs text-[var(--color-error)]" role="alert">
                Couldn’t open GitHub. Try again.
              </p>
            {/if}
          </div>
        {/if}
      </div>
    </nav>
  </div>

  {#if mobileMenuOpen}
    <div
      id="mobile-menu"
      class="mt-3 border-t border-[var(--color-border)] bg-[var(--color-secondary)] px-4 py-4 lg:hidden"
    >
      <nav class="flex flex-col gap-4" aria-label="Mobile navigation">
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          {#each navigation as item (item.href)}
            <li>
              <a
                href={resolve(item.href)}
                class="flex min-h-11 items-center text-base font-bold text-[var(--color-heading)] {page
                  .url.pathname === item.href
                  ? 'text-[var(--color-accent)]'
                  : ''}">{item.label}</a
              >
            </li>
          {/each}
          {#if user && $currentActor.isAdmin}
            <li>
              <a href={resolve('/submit')} class="flex min-h-11 items-center font-bold">Submit</a>
            </li>
          {/if}
        </ul>

        <div class="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3">
          {#if !$currentActor.initialized}
            <p
              role="status"
              class="flex min-h-11 items-center text-sm text-[var(--color-text-muted)]"
            >
              Checking session…
            </p>
          {:else if user}
            <div class="flex flex-wrap items-center gap-3">
              <a href={githubUrl} target="_blank" rel="noopener noreferrer external">@{username}</a>
              <a
                href={resolve('/settings')}
                class="flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--color-text)] hover:bg-[var(--color-tertiary)] hover:text-[var(--color-accent)]"
                title="Settings"
                aria-label="Settings"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  class="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                  ></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </a>
              <button
                class="min-h-11 border border-[var(--color-border)] px-3 disabled:cursor-wait disabled:opacity-70"
                on:click={handleLogout}
                disabled={logoutBusy}
                aria-busy={logoutBusy}>{logoutBusy ? 'Signing out…' : 'Logout'}</button
              >
            </div>
          {:else}
            <div class="flex flex-wrap items-center gap-3">
              <a
                href={resolve('/settings')}
                class="flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--color-text)] hover:bg-[var(--color-tertiary)] hover:text-[var(--color-accent)]"
                title="Settings"
                aria-label="Settings"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  class="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                  ></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </a>
              <button
                type="button"
                class="min-h-11 border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 font-bold text-[var(--color-on-accent)] disabled:opacity-70"
                on:click={handleLogin}
                disabled={loginBusy}
                aria-busy={loginBusy}
              >
                {#if loginBusy}<span
                    class="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                    aria-hidden="true"
                  ></span>{/if}
                {loginBusy ? 'Opening GitHub…' : 'Sign in'}
              </button>
            </div>
            {#if loginError}
              <p class="mt-2 text-sm text-[var(--color-error)]" role="alert">
                Couldn’t open GitHub. Try again.
              </p>
            {/if}
          {/if}
        </div>
      </nav>
    </div>
  {/if}

  {#if logoutError}
    <div
      class="mx-auto mt-2 flex max-w-[1200px] items-center justify-end gap-2 px-3 text-sm text-[var(--color-error)]"
      role="alert"
    >
      <span>Couldn’t sign out. Try again.</span>
    </div>
  {/if}
</header>
