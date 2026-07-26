<script lang="ts">
  import { THEME_PREFERENCES, type ThemePreference } from '$lib/services/appearance';

  export let preference: ThemePreference;
  export let onSelect: (preference: ThemePreference) => void;

  const options: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];

  let buttons: (HTMLButtonElement | null)[] = [];

  function focusOption(index: number): void {
    const target = ((index % options.length) + options.length) % options.length;
    buttons[target]?.focus();
    onSelect(options[target].value);
  }

  function handleKeydown(event: KeyboardEvent, index: number): void {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusOption(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusOption(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusOption(0);
        break;
      case 'End':
        event.preventDefault();
        focusOption(options.length - 1);
        break;
    }
  }
</script>

<div
  role="radiogroup"
  aria-label="Theme"
  class="inline-flex items-stretch overflow-hidden rounded-md border-2 border-[var(--color-border)]"
>
  {#each options as option, index (option.value)}
    {@const selected = preference === option.value}
    <button
      bind:this={buttons[index]}
      type="button"
      role="radio"
      aria-label={option.label}
      aria-checked={selected}
      tabindex={selected || (!THEME_PREFERENCES.includes(preference) && index === 0) ? 0 : -1}
      data-theme-preference={option.value}
      class="flex min-h-11 min-w-11 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)] {index >
      0
        ? 'border-l-2 border-[var(--color-border)]'
        : ''} {selected
        ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
        : 'bg-[var(--color-secondary)] text-[var(--color-text-muted)] hover:bg-[var(--color-tertiary)] hover:text-[var(--color-text)]'}"
      on:click={() => onSelect(option.value)}
      on:keydown={(event) => handleKeydown(event, index)}
    >
      {#if option.value === 'system'}
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
      {:else if option.value === 'light'}
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
      <span class="hidden sm:inline">{option.label}</span>
    </button>
  {/each}
</div>
