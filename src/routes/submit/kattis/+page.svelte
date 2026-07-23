<script lang="ts">
import ProblemSubmitForm from '$lib/components/ProblemSubmitForm.svelte';
import type { ProcessOutcome } from '$lib/components/submitForm';
import {
  extractKattisProblemInfo,
  fetchKattisProblemData,
  formatKattisUrl,
  extractKattisUrls
} from '$lib/services/kattis';
import { insertProblem } from '$lib/services/problem';

// Fetch and insert a single Kattis problem. Errors (invalid URL, provider
// failure, duplicate, insert failure) are returned as a failed outcome so the
// shared form renders them in the progressive status list.
async function processKattisUrl(url: string, handle: string): Promise<ProcessOutcome> {
  const problemInfo = extractKattisProblemInfo(url);
  if (!problemInfo) {
    return { success: false, kind: 'problem', message: 'Invalid URL format' };
  }

  const result = await fetchKattisProblemData(problemInfo, handle);
  if (!result.success || !result.problem) {
    return {
      success: false,
      kind: 'problem',
      message: result.message || 'Failed to fetch problem data'
    };
  }

  const insertResult = await insertProblem(result.problem);
  if (!insertResult.success) {
    return { success: false, kind: 'problem', message: insertResult.message };
  }

  return {
    success: true,
    kind: 'problem',
    name: result.problem.name,
    message: 'Problem added',
    details: insertResult.id ? `ID: ${insertResult.id}` : undefined
  };
}
</script>

<svelte:head>
  <title>Submit | Kattis</title>
</svelte:head>

<ProblemSubmitForm
  title="Submit Kattis Problems"
  platformName="Kattis"
  platformIcon="/images/kattis.png"
  handlePlaceholder="Enter your Kattis handle (optional)"
  urlsPlaceholder="open.kattis.com/problems/hello&#10;open.kattis.com/problems/twostones&#10;customscontrols"
  urlsDescription="Enter Kattis problem URLs or bare problem IDs. Separate multiple entries with spaces or new lines."
  extractUrls={extractKattisUrls}
  processUrl={processKattisUrl}
  formatItemLabel={(item) => formatKattisUrl(item.url, item.name)}
/>
