<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { currentActor, signInWithGithub, signOut } from '$lib/auth/currentActor';
  import {
    currentThemePreference,
    setThemePreference,
    THEME_PREFERENCES,
    type ThemePreference
  } from '$lib/services/theme';

  let mobileMenuOpen = false;
  let mobileMenuButton: HTMLButtonElement | null = null;
  let appearanceOpen = false;
  let appearanceButton: HTMLButtonElement | null = null;
  let appearancePanel: HTMLDivElement | null = null;
  let loginBusy = false;
  let loginError = page.url.pathname === '/' && page.url.searchParams.get('auth_error') === 'true';
  let logoutBusy = false;
  let logoutError = false;
  let themeSaveError = false;
  let themeSaveRevision = 0;
  let failedThemePreference: ThemePreference | null = null;

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

  async function selectAppearance(preference: ThemePreference): Promise<void> {
    const revision = ++themeSaveRevision;
    const userId = user?.id;
    themeSaveError = false;
    failedThemePreference = null;
    const saved = await setThemePreference(preference);
    if (revision !== themeSaveRevision || !userId || user?.id !== userId) return;
    if (!saved) {
      themeSaveError = true;
      failedThemePreference = preference;
    }
  }

  function retryThemeSave(): void {
    if (failedThemePreference) void selectAppearance(failedThemePreference);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (appearanceOpen) {
      appearanceOpen = false;
      appearanceButton?.focus();
    } else if (mobileMenuOpen) {
      mobileMenuOpen = false;
      mobileMenuButton?.focus();
    }
  }

  function handleWindowPointerDown(event: PointerEvent): void {
    const target = event.target as Node;
    if (
      appearanceOpen &&
      !appearancePanel?.contains(target) &&
      !appearanceButton?.contains(target)
    ) {
      appearanceOpen = false;
    }
  }

  afterNavigate(() => {
    mobileMenuOpen = false;
    appearanceOpen = false;
    loginError = page.url.pathname === '/' && page.url.searchParams.get('auth_error') === 'true';
  });
</script>

<svelte:window on:keydown={handleWindowKeydown} on:pointerdown={handleWindowPointerDown} />

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

      <div class="relative">
        <button
          bind:this={appearanceButton}
          type="button"
          class="rounded border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm font-bold text-[var(--color-text)] hover:bg-[var(--color-tertiary)]"
          aria-haspopup="true"
          aria-expanded={appearanceOpen}
          aria-controls="appearance-popover"
          on:click={() => (appearanceOpen = !appearanceOpen)}
        >
          Appearance
        </button>
        {#if appearanceOpen}
          <div
            bind:this={appearancePanel}
            id="appearance-popover"
            class="absolute right-0 mt-2 w-44 border-2 border-[var(--color-border)] bg-[var(--color-secondary)] p-2 shadow-lg"
          >
            <fieldset>
              <legend class="sr-only">Appearance</legend>
              {#each THEME_PREFERENCES as preference (preference)}
                <label
                  class="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm capitalize hover:bg-[var(--color-tertiary)]"
                >
                  <input
                    type="radio"
                    name="desktop-appearance"
                    value={preference}
                    checked={$currentThemePreference === preference}
                    on:change={() => void selectAppearance(preference)}
                  />
                  {preference}
                </label>
              {/each}
            </fieldset>
          </div>
        {/if}
      </div>

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
          <a href={resolve('/settings')} class="p-2" aria-label="Settings">Settings</a>
          <button
            class="rounded border border-[var(--color-border)] px-3 py-2 text-sm font-bold disabled:cursor-wait disabled:opacity-70"
            on:click={handleLogout}
            disabled={logoutBusy}
            aria-busy={logoutBusy}>{logoutBusy ? 'Signing out…' : 'Logout'}</button
          >
        {:else}
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
              {loginBusy ? 'Opening GitHub…' : 'Continue with GitHub'}
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

        <fieldset class="border-t border-[var(--color-border)] pt-3">
          <legend class="mb-1 font-bold text-[var(--color-heading)]">Appearance</legend>
          <div class="grid grid-cols-3 gap-2">
            {#each THEME_PREFERENCES as preference (preference)}
              <label
                class="flex min-h-11 cursor-pointer items-center justify-center gap-2 border border-[var(--color-border)] px-2 capitalize has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-tertiary)]"
              >
                <input
                  type="radio"
                  name="mobile-appearance"
                  value={preference}
                  checked={$currentThemePreference === preference}
                  on:change={() => void selectAppearance(preference)}
                />
                {preference}
              </label>
            {/each}
          </div>
        </fieldset>

        <div class="border-t border-[var(--color-border)] pt-3">
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
              <a href={resolve('/settings')} class="flex min-h-11 items-center">Settings</a>
              <button
                class="min-h-11 border border-[var(--color-border)] px-3 disabled:cursor-wait disabled:opacity-70"
                on:click={handleLogout}
                disabled={logoutBusy}
                aria-busy={logoutBusy}>{logoutBusy ? 'Signing out…' : 'Logout'}</button
              >
            </div>
          {:else}
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
              {loginBusy ? 'Opening GitHub…' : 'Continue with GitHub'}
            </button>
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

  {#if themeSaveError || logoutError}
    <div
      class="mx-auto mt-2 flex max-w-[1200px] items-center justify-end gap-2 px-3 text-sm text-[var(--color-error)]"
      role="alert"
    >
      <span>{themeSaveError ? 'Appearance could not sync.' : 'Couldn’t sign out. Try again.'}</span>
      {#if themeSaveError}
        <button
          type="button"
          class="min-h-11 border border-[var(--color-error)] px-3 font-bold"
          on:click={retryThemeSave}>Retry</button
        >
      {/if}
    </div>
  {/if}
</header>
