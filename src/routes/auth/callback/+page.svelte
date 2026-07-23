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
  // GitHub/Supabase surface OAuth failures either as an `error` in the URL
  // hash or as an `auth_error` query param; in both cases send the user home.
  const errorInHash = /(?:^|[#&])error(?:_code|_description)?=/.test(page.url.hash);
  const errorInQuery = page.url.searchParams.has('auth_error');
  if (errorInHash || errorInQuery) {
    await goto(AUTH_ERROR_PATH, { replaceState: true });
    return;
  }

  const target = sanitizeRedirect(page.url.searchParams.get('next')) as ResolvedPathname;

  // Resolve the session the client parsed from the hash. On success forward to
  // the validated target; if no session materialized, treat it as a failed
  // sign-in rather than silently landing on an authless callback URL.
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    await goto(target, { replaceState: true });
  } else {
    await goto(AUTH_ERROR_PATH, { replaceState: true });
  }
});
</script>

<div class="flex min-h-[40vh] items-center justify-center">
  <p class="text-[var(--color-heading)]">Signing you in…</p>
</div>
