<script>
// Footer component
</script>

<footer
  class="relative z-20 mt-auto border-t-2 border-[var(--color-border)] bg-[var(--color-secondary)] py-6"
>
  <div class="mx-auto max-w-7xl px-6 sm:px-3 md:px-4">
    <div class="flex items-center justify-between">
      <div class="colophon text-sm text-[var(--color-text-muted)]">
        © {new Date().getFullYear()} gitgud — curated competitive programming
      </div>
      <div class="flex gap-6">
        <a
          href="https://github.com/cameroncuster/gitgud"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub Repository"
          class="flex items-center gap-2 text-sm text-[var(--color-text)] no-underline transition-colors duration-200 hover:text-[var(--color-accent)]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"
            ></path>
          </svg>
          <span>GitHub</span>
        </a>
      </div>
    </div>
  </div>
</footer>

<style>
/* Ensure footer is positioned correctly */
footer {
  position: relative;
  left: 0;
  right: 0;
  width: 100%;
  margin-top: auto;
}

/* Colophon set in the serif face, echoing a newspaper's masthead credit. */
.colophon {
  font-family: var(--font-serif);
  font-style: italic;
}
</style>
