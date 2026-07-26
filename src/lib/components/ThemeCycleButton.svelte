<script lang="ts">
  import { nextThemePreference, type ThemePreference } from '$lib/services/appearance';

  export let preference: ThemePreference;
  export let onCycle: () => void;

  const displayName = (value: ThemePreference) =>
    `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;

  $: nextPreference = nextThemePreference(preference);
  $: label = `Theme: ${displayName(preference)}. Switch to ${displayName(nextPreference)}`;
</script>

<button
  type="button"
  class="flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-tertiary)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
  aria-label={label}
  title={label}
  data-theme-preference={preference}
  on:click={onCycle}
>
  {#if preference === 'system'}
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
      <rect x="3" y="4" width="18" height="12" rx="2"></rect>
      <path d="M8 20h8M12 16v4"></path>
    </svg>
  {:else if preference === 'light'}
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      class="h-5 w-5"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    >
      <circle cx="12" cy="12" r="4"></circle>
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"
      ></path>
    </svg>
  {:else}
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
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"></path>
    </svg>
  {/if}
</button>
