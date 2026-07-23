<script lang="ts">
export let variant: 'problem' | 'contest';
</script>

<div class="scroll-affordance mt-4 w-full" data-variant={variant}>
  <div
    class="table-wrapper rounded-md border-2 border-[var(--color-border)] bg-[var(--color-secondary)]"
  >
    <slot />
  </div>
</div>

<style>
.table-wrapper {
  overflow-x: auto;
}

[data-variant='problem'] {
  max-width: 100%;
}

[data-variant='problem'] .table-wrapper {
  width: 100%;
  -webkit-overflow-scrolling: touch;
}

[data-variant='contest'] .table-wrapper {
  position: relative;
}

@media (max-width: 768px) {
  [data-variant='problem'],
  [data-variant='problem'] .table-wrapper {
    margin-right: auto;
    margin-left: auto;
  }
}

@media (min-width: 768px) {
  [data-variant='problem'] .table-wrapper {
    margin-left: 0;
  }
}

@media (max-width: 899px) {
  .scroll-affordance {
    position: relative;
  }

  .scroll-affordance::after {
    position: absolute;
    z-index: 20;
    top: 2px;
    right: 2px;
    bottom: 2px;
    width: 2rem;
    border-top-right-radius: 0.375rem;
    border-bottom-right-radius: 0.375rem;
    background: linear-gradient(
      to right,
      transparent,
      color-mix(in oklab, var(--color-secondary) 85%, transparent)
    );
    pointer-events: none;
    content: '';
  }

  .table-wrapper {
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }

  .table-wrapper::-webkit-scrollbar {
    height: 6px;
  }

  .table-wrapper::-webkit-scrollbar-thumb {
    border-radius: 9999px;
    background-color: var(--color-border);
  }
}
</style>
