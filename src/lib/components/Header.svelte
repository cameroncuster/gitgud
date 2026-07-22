<script lang="ts">
import { page } from '$app/state';
import { afterNavigate } from '$app/navigation';
import { resolve } from '$app/paths';
import { user } from '$lib/services/auth';
import { signInWithGithub, signOut, isAdmin } from '$lib/services/auth';
import { onMount } from 'svelte';

// Add a loading state to prevent button flash
let authLoading = true;

// Use a flag to ensure we've fully mounted before showing anything
let isMounted = false;

// Mobile menu state
let mobileMenuOpen = false;

// Track admin status
let isUserAdmin = false;

// User information from GitHub OAuth
let username = '';
let githubUrl = '';

onMount(() => {
  // Mark component as mounted
  isMounted = true;

  // Set a small timeout to ensure smooth loading and prevent flashing
  setTimeout(() => {
    if (isMounted) {
      // Only set authLoading to false if we have user data or after a timeout
      if ($user || !$user) {
        authLoading = false;
      }
    }
  }, 300);

  // Set up a subscription to the user store
  const unsubscribe = user.subscribe(async (value) => {
    // Only update user data if we're mounted
    if (isMounted) {
      // Check if the user is an admin
      if (value) {
        isUserAdmin = await isAdmin(value.id);

        // Get username and GitHub URL from user metadata
        if (value.user_metadata) {
          // Get username with priority order
          if (value.user_metadata.user_name) {
            username = value.user_metadata.user_name;
          } else if (value.user_metadata.preferred_username) {
            username = value.user_metadata.preferred_username;
          } else if (value.user_metadata.name) {
            username = value.user_metadata.name;
          } else if (value.email) {
            // Fallback to email if no username is available
            username = value.email.split('@')[0];
          } else {
            username = 'User';
          }

          // Get GitHub URL
          if (value.app_metadata && value.app_metadata.provider === 'github') {
            githubUrl = `https://github.com/${username}`;
          } else if (value.user_metadata.html_url) {
            githubUrl = value.user_metadata.html_url;
          } else if (
            value.user_metadata.avatar_url &&
            value.user_metadata.avatar_url.includes('github')
          ) {
            // Extract username from GitHub avatar URL if available
            // Format is usually: https://avatars.githubusercontent.com/u/12345678?v=4
            githubUrl = `https://github.com/${username}`;
          } else {
            githubUrl = `https://github.com/${username}`;
          }
        } else if (value.email) {
          username = value.email.split('@')[0];
          githubUrl = '';
        } else {
          username = 'User';
          githubUrl = '';
        }
      } else {
        isUserAdmin = false;
        username = '';
        githubUrl = '';
      }
    }
  });

  // Clean up subscription on component unmount
  return () => {
    isMounted = false;
    unsubscribe();
  };
});

async function handleLogin() {
  try {
    await signInWithGithub();
    mobileMenuOpen = false;
  } catch (error) {
    console.error('Login error:', error);
  }
}

async function handleLogout() {
  try {
    await signOut();
    mobileMenuOpen = false;
  } catch (error) {
    console.error('Logout error:', error);
  }
}

function toggleMobileMenu() {
  mobileMenuOpen = !mobileMenuOpen;
}

// Close mobile menu when navigating to a new page
afterNavigate(() => {
  mobileMenuOpen = false;
});
</script>

<header
  class="sticky top-0 z-50 w-full border-b border-[var(--color-border)] bg-[var(--color-secondary)] py-3"
>
  <div class="mx-auto flex max-w-[1200px] items-center justify-between px-3 sm:px-4 md:px-5">
    <div class="flex items-center">
      <a
        href={resolve('/')}
        aria-label="Home"
        class="flex items-center gap-2 pr-2 text-xl font-bold text-[var(--color-heading)] no-underline lg:pr-4"
      >
        <img src="/favicon.png" alt="gitgud Logo" class="h-12 w-12 object-contain" />
        <span class="flex font-bold tracking-wide">
          <span class="text-[var(--color-accent)]">gitgud</span><span
            class="hidden text-[var(--color-heading)] sm:inline">.cc</span
          >
        </span>
      </a>
    </div>

    <!-- Mobile menu button -->
    <button
      class="flex items-center rounded-md border-2 border-[var(--color-border)] px-2 py-1 text-[var(--color-text)] transition-colors hover:bg-[var(--color-tertiary)] lg:hidden"
      aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
      on:click={toggleMobileMenu}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {#if mobileMenuOpen}
          <path d="M18 6L6 18M6 6l12 12"></path>
        {:else}
          <path d="M3 12h18M3 6h18M3 18h18"></path>
        {/if}
      </svg>
    </button>

    <!-- Desktop navigation -->
    <nav class="hidden items-center gap-6 lg:flex lg:gap-4">
      <ul class="m-0 flex list-none gap-2 p-0 lg:gap-3 xl:gap-4">
        <li
          class="relative {page.url.pathname === '/'
            ? "after:absolute after:-bottom-2 after:left-0 after:h-0.5 after:w-full after:rounded-sm after:bg-[var(--color-accent)] after:content-['']"
            : ''}"
        >
          <a
            href={resolve('/')}
            class="block py-2 text-sm font-bold text-[var(--color-heading)] no-underline transition-colors duration-200 hover:text-[var(--color-accent)] lg:text-base"
            >Problems</a
          >
        </li>
        <li
          class="relative {page.url.pathname === '/contests'
            ? "after:absolute after:-bottom-2 after:left-0 after:h-0.5 after:w-full after:rounded-sm after:bg-[var(--color-accent)] after:content-['']"
            : ''}"
        >
          <a
            href={resolve('/contests')}
            class="block py-2 text-sm font-bold text-[var(--color-heading)] no-underline transition-colors duration-200 hover:text-[var(--color-accent)] lg:text-base"
            >Contests</a
          >
        </li>
        <li
          class="relative {page.url.pathname === '/leaderboard'
            ? "after:absolute after:-bottom-2 after:left-0 after:h-0.5 after:w-full after:rounded-sm after:bg-[var(--color-accent)] after:content-['']"
            : ''}"
        >
          <a
            href={resolve('/leaderboard')}
            class="block py-2 text-sm font-bold text-[var(--color-heading)] no-underline transition-colors duration-200 hover:text-[var(--color-accent)] lg:text-base"
            >Leaderboard</a
          >
        </li>
        <li
          class="relative {page.url.pathname === '/about'
            ? "after:absolute after:-bottom-2 after:left-0 after:h-0.5 after:w-full after:rounded-sm after:bg-[var(--color-accent)] after:content-['']"
            : ''}"
        >
          <a
            href={resolve('/about')}
            class="block py-2 text-sm font-bold text-[var(--color-heading)] no-underline transition-colors duration-200 hover:text-[var(--color-accent)] lg:text-base"
            >About</a
          >
        </li>
        {#if $user && isUserAdmin}
          <li
            class="relative {page.url.pathname === '/submit'
              ? "after:absolute after:-bottom-2 after:left-0 after:h-0.5 after:w-full after:rounded-sm after:bg-[var(--color-accent)] after:content-['']"
              : ''}"
          >
            <a
              href={resolve('/submit')}
              class="block py-2 text-sm font-bold text-[var(--color-heading)] no-underline transition-colors duration-200 hover:text-[var(--color-accent)] lg:text-base"
              >Submit</a
            >
          </li>
        {/if}
      </ul>
      <div
        class="mr-4 flex min-w-[70px] items-center justify-end gap-3 transition-opacity duration-300 sm:mr-2 md:mr-0 {authLoading
          ? 'invisible opacity-0'
          : 'visible opacity-100'}"
        style="will-change: opacity;"
      >
        {#if $user}
          <div class="flex items-center gap-3">
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer external"
              class="text-sm font-medium text-[var(--color-username)] transition-colors duration-200 hover:text-[color-mix(in_oklab,var(--color-username)_80%,white)]"
            >
              @{username}
            </a>
            <a
              href={resolve('/settings')}
              class="flex items-center justify-center rounded-full p-1.5 text-[var(--color-text)] transition-colors hover:bg-[var(--color-tertiary)] hover:text-[var(--color-accent)]"
              title="Settings"
              aria-label="Settings"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-5 w-5"
                aria-hidden="true"
              >
                <path
                  d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                ></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </a>
            <button
              class="cursor-pointer rounded border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-sm font-bold text-[var(--color-text)] transition-colors hover:bg-[var(--color-tertiary)]"
              on:click={handleLogout}
            >
              Logout
            </button>
          </div>
        {:else}
          <button
            class="cursor-pointer rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-1.5 text-sm font-bold text-white transition-colors hover:brightness-110"
            on:click={handleLogin}
            title="Login with GitHub"
          >
            <span>Sign in</span>
          </button>
        {/if}
      </div>
    </nav>
  </div>

  <!-- Mobile menu -->
  {#if mobileMenuOpen}
    <div
      class="mt-3 border-t border-[var(--color-border)] bg-[var(--color-secondary)] px-4 py-4 lg:hidden"
    >
      <nav class="flex flex-col gap-4">
        <ul class="m-0 flex list-none flex-col gap-4 p-0">
          <li>
            <a
              href={resolve('/')}
              class="block py-2 text-base font-bold text-[var(--color-heading)] no-underline transition-colors duration-200 hover:text-[var(--color-accent)] {page.url.pathname === '/' ? 'text-[var(--color-accent)]' : ''}"
              >Problems</a
            >
          </li>
          <li>
            <a
              href={resolve('/contests')}
              class="block py-2 text-base font-bold text-[var(--color-heading)] no-underline transition-colors duration-200 hover:text-[var(--color-accent)] {page.url.pathname === '/contests' ? 'text-[var(--color-accent)]' : ''}"
              >Contests</a
            >
          </li>
          <li>
            <a
              href={resolve('/leaderboard')}
              class="block py-2 text-base font-bold text-[var(--color-heading)] no-underline transition-colors duration-200 hover:text-[var(--color-accent)] {page.url.pathname === '/leaderboard' ? 'text-[var(--color-accent)]' : ''}"
              >Leaderboard</a
            >
          </li>
          <li>
            <a
              href={resolve('/about')}
              class="block py-2 text-base font-bold text-[var(--color-heading)] no-underline transition-colors duration-200 hover:text-[var(--color-accent)] {page.url.pathname === '/about' ? 'text-[var(--color-accent)]' : ''}"
              >About</a
            >
          </li>
          {#if $user && isUserAdmin}
            <li>
              <a
                href={resolve('/submit')}
                class="block py-2 text-base font-bold text-[var(--color-heading)] no-underline transition-colors duration-200 hover:text-[var(--color-accent)] {page.url.pathname === '/submit' ? 'text-[var(--color-accent)]' : ''}"
                >Submit</a
              >
            </li>
          {/if}
        </ul>
        <div
          class="mt-2 flex flex-col items-start justify-start gap-3 px-1 transition-opacity duration-300 {authLoading ? 'invisible opacity-0' : 'visible opacity-100'}"
          style="will-change: opacity;"
        >
          {#if $user}
            <div class="flex items-center gap-3">
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer external"
                class="text-sm font-medium text-[var(--color-username)] transition-colors duration-200 hover:text-[color-mix(in_oklab,var(--color-username)_80%,white)]"
              >
                @{username}
              </a>
              <a
                href={resolve('/settings')}
                class="flex items-center justify-center rounded-full p-1.5 text-[var(--color-text)] transition-colors hover:bg-[var(--color-tertiary)] hover:text-[var(--color-accent)]"
                title="Settings"
                aria-label="Settings"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                  ></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </a>
            </div>
            <button
              class="cursor-pointer rounded border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-sm font-bold text-[var(--color-text)] transition-colors hover:bg-[var(--color-tertiary)]"
              on:click={handleLogout}
            >
              Logout
            </button>
          {:else}
            <button
              class="cursor-pointer rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-1.5 text-sm font-bold text-white transition-colors hover:brightness-110"
              on:click={handleLogin}
              title="Login with GitHub"
            >
              <span>Sign in</span>
            </button>
          {/if}
        </div>
      </nav>
    </div>
  {/if}
</header>

<style>
/* Add smooth transitions for mobile menu */
@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

div.lg\:hidden {
  animation: slideDown 0.2s ease-out;
}

/* Ensure header is at the top */
header {
  left: 0;
  right: 0;
}

/* Ensure username is always blue */
a[href*='github.com'] {
  color: var(--color-username) !important;
  text-decoration: none;
  position: relative;
}

a[href*='github.com']:hover {
  color: color-mix(in oklab, var(--color-username) 80%, white) !important;
}

/* Add retro underline effect to nav links */
li.relative a:hover {
  text-decoration: none;
}

</style>
