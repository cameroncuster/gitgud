<script lang="ts">
import Footer from '$lib/components/Footer.svelte';
import Header from '$lib/components/Header.svelte';
import '../app.css';
import { onMount } from 'svelte';
import { currentActor, startCurrentActor } from '$lib/auth/currentActor';
import { loadThemePreference, applyTheme } from '$lib/services/theme';
import { browser } from '$app/environment';

onMount(() => {
  let mounted = true;
  let themedUserId: string | null = null;
  let stopActor: (() => void) | null = null;
  const actorUnsubscribe = currentActor.subscribe(async (actor) => {
    if (actor.user && actor.user.id !== themedUserId) {
      themedUserId = actor.user.id;
      await loadThemePreference();
    } else if (!actor.user) {
      themedUserId = null;
    }
  });

  const initialize = async () => {
    if (browser) {
      applyTheme(localStorage.getItem('gitgud-theme') || 'light');
    }
    const stop = await startCurrentActor();
    if (mounted) stopActor = stop;
    else stop();
  };
  void initialize();

  return () => {
    mounted = false;
    actorUnsubscribe();
    stopActor?.();
  };
});
</script>

<div class="flex min-h-screen flex-col overflow-hidden">
  <!-- Skip link: visually hidden until focused, lets keyboard users jump past
       the header straight to the page content. -->
  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:border-2 focus:border-[var(--color-border)] focus:bg-[var(--color-secondary)] focus:px-3 focus:py-2 focus:text-[var(--color-text)]"
  >
    Skip to main content
  </a>

  <Header />

  <main
    id="main-content"
    tabindex="-1"
    class="relative mx-auto box-border flex w-full flex-1 flex-col overflow-x-hidden px-2 outline-none sm:px-3 md:px-4"
  >
    <slot />
  </main>

  <Footer />
</div>

<style>
/* Global styles that can't be handled with Tailwind directly */
:global(html),
:global(body) {
  overflow-x: hidden;
  max-width: 100vw;
  margin: 0;
  padding: 0;
  overscroll-behavior-y: none;
  position: relative;
  height: 100%;
}

:global(.container) {
  width: 100%;
  box-sizing: border-box;
  padding-left: 1rem;
  padding-right: 1rem;
}

/* Ensure content is centered properly */
main {
  position: relative;
}

@media (min-width: 768px) {
  :global(.container) {
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }
}

@media (max-width: 768px) {
  :global(.container) {
    padding-left: 1rem;
    padding-right: 1rem;
  }
}

/* Ensure consistent max-width across components */
:global(.max-w-\[1200px\]) {
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: 0 0.5rem;
}

/* Ensure header and footer are at the ends */
:global(header),
:global(footer) {
  width: 100%;
  position: relative;
  z-index: 30;
}
</style>
