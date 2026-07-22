<script lang="ts">
import { browser } from '$app/environment';
import { onMount } from 'svelte';
import { AVAILABLE_THEMES } from '../theme';
import { retroBeigeTheme } from '../theme-options/retro-beige';
import { retroPurpleTheme } from '../theme-options/retro-purple';
import { retroTealTheme } from '../theme-options/retro-teal';
import { retroBlueLightTheme } from '../theme-options/retro-blue-light';
import { retroBlueDarkTheme } from '../theme-options/retro-blue-dark';

// Current theme (default is the blue light theme)
let currentTheme = 'retro-blue-light';

// Use the themes from the constants
const themes = AVAILABLE_THEMES;

// Load theme from localStorage on mount
onMount(() => {
  if (browser) {
    const savedTheme = localStorage.getItem('gitgud-theme');
    if (savedTheme) {
      applyTheme(savedTheme);
    } else {
      // Apply default theme (blue light)
      applyTheme('retro-blue-light');
    }
  }
});

// Function to apply a theme
function applyTheme(themeId: string) {
  currentTheme = themeId;

  // Save theme preference to localStorage
  if (browser) {
    localStorage.setItem('gitgud-theme', themeId);
  }

  // Apply the selected theme
  let themeColors = '';

  switch (themeId) {
    case 'retro-blue-light':
      themeColors = retroBlueLightTheme.colors;
      break;
    case 'retro-blue-dark':
      themeColors = retroBlueDarkTheme.colors;
      break;
    case 'retro-beige':
      themeColors = retroBeigeTheme.colors;
      break;
    case 'retro-purple':
      themeColors = retroPurpleTheme.colors;
      break;
    case 'retro-teal':
      themeColors = retroTealTheme.colors;
      break;
    default:
      // Use the blue-pink theme that's already in app.css
      break;
  }

  // If we have theme colors to apply, create a style element and add it to the head
  if (themeColors) {
    // Remove any existing theme style element
    const existingTheme = document.getElementById('theme-colors');
    if (existingTheme) {
      existingTheme.remove();
    }

    // Create a new style element
    const style = document.createElement('style');
    style.id = 'theme-colors';
    style.textContent = `:root {${themeColors}}`;
    document.head.appendChild(style);
  }
}
</script>

<div
  class="theme-switcher rounded border-2 border-[var(--color-border)] bg-[var(--color-secondary)] p-4 shadow-[2px_2px_0_rgba(0,0,0,0.1)]"
>
  <h3 class="mb-3 font-bold">Theme Switcher</h3>
  <div class="flex flex-wrap gap-2">
    {#each themes as theme (theme.id)}
      <button
        class="rounded border-2 border-[var(--color-border)] px-3 py-2 text-sm font-bold shadow-[1px_1px_0_rgba(0,0,0,0.1)] transition-all duration-200 hover:bg-[var(--color-tertiary)] hover:shadow-none {currentTheme === theme.id ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-secondary)] text-[var(--color-text)]'}"
        on:click={() => applyTheme(theme.id)}
        title={theme.description}
      >
        {theme.name}
      </button>
    {/each}
  </div>
</div>

<style>
.theme-switcher {
  max-width: 100%;
  margin-bottom: 1rem;
}

button:hover {
  transform: translateY(1px);
}
</style>
