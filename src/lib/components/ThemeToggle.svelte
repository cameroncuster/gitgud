<script lang="ts">
  import { THEME_PREFERENCES, type ThemePreference } from '$lib/services/appearance';

  export let preference: ThemePreference;
  export let onSelect: (preference: ThemePreference) => void;

  const labels: Record<ThemePreference, string> = {
    system: 'System',
    light: 'Light',
    dark: 'Dark'
  };

  let options: HTMLButtonElement[] = [];

  function selectAndFocus(nextPreference: ThemePreference): void {
    onSelect(nextPreference);
    options[THEME_PREFERENCES.indexOf(nextPreference)]?.focus();
  }

  function handleKeydown(event: KeyboardEvent): void {
    const currentIndex = THEME_PREFERENCES.indexOf(preference);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + THEME_PREFERENCES.length) % THEME_PREFERENCES.length;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % THEME_PREFERENCES.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = THEME_PREFERENCES.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    selectAndFocus(THEME_PREFERENCES[nextIndex]);
  }

  $: selectedIndex = THEME_PREFERENCES.indexOf(preference);
</script>

<div
  role="radiogroup"
  aria-label="Theme"
  tabindex="-1"
  data-theme-preference={preference}
  class="relative grid min-h-11 w-full min-w-0 grid-cols-3 rounded-md border-2 border-[var(--color-border)] bg-[var(--color-tertiary)] p-1 sm:w-auto sm:min-w-72"
  on:keydown={handleKeydown}
>
  <span
    aria-hidden="true"
    data-testid="theme-toggle-indicator"
    class="pointer-events-none absolute top-1 bottom-1 left-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-secondary)] shadow-sm transition-transform duration-200 motion-reduce:transition-none"
    style={`width: calc((100% - 0.5rem) / 3); transform: translateX(${selectedIndex * 100}%);`}
  ></span>

  {#each THEME_PREFERENCES as option, index (option)}
    <button
      bind:this={options[index]}
      type="button"
      role="radio"
      aria-checked={preference === option}
      tabindex={preference === option ? 0 : -1}
      class="relative z-10 min-h-11 min-w-0 rounded-sm px-3 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] aria-checked:font-bold aria-checked:text-[var(--color-text)]"
      on:click={() => onSelect(option)}
    >
      {labels[option]}
    </button>
  {/each}
</div>
