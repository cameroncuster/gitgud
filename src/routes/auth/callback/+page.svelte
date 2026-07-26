<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { ResolvedPathname } from '$app/types';
  import { supabase } from '$lib/services/database';
  import { sanitizeRedirect, DEFAULT_REDIRECT } from '$lib/services/redirect';

  // The home path plus the failed-login marker. sanitizeRedirect already
  // guarantees same-origin relative paths, so both targets are safe to hand to
  // goto without a further resolve() (their ResolvedPathname type satisfies
  // svelte/no-navigation-without-resolve).
  const AUTH_ERROR_PATH = `${DEFAULT_REDIRECT}?auth_error=true` as ResolvedPathname;

  // Landing page for the GitHub OAuth redirect (`redirectTo` in
  // signInWithGithub). The browser Supabase client is configured for the
  // implicit flow and detects the session from the URL hash automatically
  // (detectSessionInUrl). This page simply waits for that detection to resolve,
  // then forwards the user to a validated same-origin `next` path. Redirect
  // validation lives in sanitizeRedirect so a hostile `next` (e.g. `//evil.com`)
  // can never turn this into an open redirect.

  onMount(async () => {
    try {
      const errorInHash = /(?:^|[#&])error(?:_code|_description)?=/.test(page.url.hash);
      const errorInQuery = page.url.searchParams.has('auth_error');
      if (errorInHash || errorInQuery) {
        await goto(AUTH_ERROR_PATH, { replaceState: true });
        return;
      }

      const target = sanitizeRedirect(page.url.searchParams.get('next')) as ResolvedPathname;
      const { data, error } = await supabase.auth.getSession();
      if (data.session && !error) {
        await goto(target, { replaceState: true });
      } else {
        await goto(AUTH_ERROR_PATH, { replaceState: true });
      }
    } catch {
      try {
        await goto(AUTH_ERROR_PATH, { replaceState: true });
      } catch {
        window.location.assign(AUTH_ERROR_PATH);
      }
    }
  });
</script>

<svelte:head>
  <title>Finishing sign-in</title>
</svelte:head>

<div class="flex min-h-[55vh] items-center justify-center px-4">
  <section
    class="w-full max-w-lg border-2 border-[var(--color-border)] bg-[var(--color-secondary)] p-8 text-center"
    aria-labelledby="callback-title"
  >
    <div class="mb-6 flex items-center justify-center gap-4 text-lg font-bold" aria-hidden="true">
      <span class="border border-[var(--color-border)] px-3 py-2">GitHub</span>
      <span>→</span>
      <span class="text-[var(--color-accent)]">gitgud</span>
    </div>
    <h1 id="callback-title" class="text-2xl font-bold">Finishing secure sign-in</h1>
    <p class="mt-3 text-[var(--color-text-muted)]">
      Verifying your GitHub session. You’ll return automatically.
    </p>
    <div class="mt-6 flex items-center justify-center gap-3" role="status" aria-live="polite">
      <span
        class="callback-spinner h-5 w-5 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]"
        aria-hidden="true"
      ></span>
      <span>Verification in progress</span>
    </div>
  </section>
</div>

<style>
  .callback-spinner {
    animation: callback-spin 0.8s linear infinite;
  }

  @keyframes callback-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .callback-spinner {
      animation: none;
    }
  }
</style>
