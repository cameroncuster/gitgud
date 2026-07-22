<script lang="ts">
import ProblemDisplay from '$lib/components/ProblemDisplay.svelte';
import type { PageData } from './$types';

export let data: PageData;
</script>

<ProblemDisplay
  pageTitle="Problems"
  defaultSolvedFilterState="all"
  initialProblems={data.problems}
/>
