<script lang="ts">
// Props
export let authors: string[] = [];
export let selectedAuthor: string | null = null;
export let onAuthorChange: (author: string | null) => void;
export let width: string = 'w-full';
</script>

<div class="relative {width}">
  <div class="pointer-events-none absolute inset-y-0 left-2 flex items-center">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="text-[var(--color-text-muted)]"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
  </div>
  <select
    class="focus:ring-opacity-20 w-full appearance-none rounded-md border py-1.5 pr-8 pl-9 text-sm shadow-sm transition-all duration-200 hover:border-[var(--color-accent-muted)] focus:border-[var(--color-accent)] focus:ring focus:ring-[var(--color-accent)] focus:outline-none {selectedAuthor ? 'border-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_10%,var(--color-tertiary))] text-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-tertiary)] text-[var(--color-text)]'}"
    on:change={(e) => {
      const select = e.target as HTMLSelectElement;
      onAuthorChange(select.value === 'all' ? null : select.value);
    }}
    aria-label="Filter by author"
    value={selectedAuthor || 'all'}
  >
    <option value="all">All recommenders</option>
    <option value="all" disabled>──────────</option>
    {#each authors as author (author)}
      <option value={author} style="color: var(--color-username);">@{author}</option>
    {/each}
  </select>
  <div class="pointer-events-none absolute inset-y-0 right-2 flex items-center">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="text-[var(--color-text-muted)]"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  </div>
</div>

<style>
/* Custom select styling */
select {
  cursor: pointer;
  background-image: none; /* Remove default arrow */
}

select:focus + div svg {
  color: var(--color-accent);
}

/* Hover effect for select */
select:hover {
  border-color: var(--color-accent-muted);
}
</style>
