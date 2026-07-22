<script lang="ts">
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { user } from '$lib/services/auth';
import { isAdmin } from '$lib/services/auth';
import { supabase } from '$lib/services/database';
import type { Unsubscriber } from 'svelte/store';

// Use static image paths instead of imports
const codeforcesLogo = '/images/codeforces.png';
const kattisLogo = '/images/kattis.png';

let isAdminUser = false;
let checkingAdmin = true;
let userUnsubscribe: Unsubscriber | null = null;
let error: string | null = null;

// Initialize auth state
onMount(() => {
  const initAuth = async () => {
    const { data } = await supabase.auth.getSession();
    const currentUser = data.session?.user || null;

    if (!currentUser) {
      goto(resolve('/'));
      return;
    }

    checkingAdmin = true;
    try {
      isAdminUser = await isAdmin(currentUser.id);
      if (!isAdminUser) {
        error = 'Only admins can submit problems.';
      }
    } catch {
      error = 'Failed to verify permissions.';
    } finally {
      checkingAdmin = false;
    }

    userUnsubscribe = user.subscribe((value) => {
      if (value === null && currentUser !== null) {
        goto(resolve('/'));
      }
    });
  };

  initAuth();
  return () => userUnsubscribe?.();
});
</script>

<svelte:head>
  <title>Submit</title>
</svelte:head>

<div class="flex w-full items-center justify-center p-4 sm:p-6">
  <div class="w-full max-w-[500px]">
    <h1 class="mb-6 text-center text-2xl font-semibold">Submit Problems</h1>

    {#if checkingAdmin}
      <div class="p-4 text-center text-blue-500">Checking permissions...</div>
    {:else if error}
      <div class="p-4 text-center text-red-500">{error}</div>
    {:else if isAdminUser}
      <div class="flex flex-col gap-6">
        <a
          href={resolve('/submit/codeforces')}
          class="bg-background border-border text-text hover:border-primary flex items-center gap-6 rounded-lg border p-4 no-underline transition-all duration-200 hover:translate-y-[-2px] hover:shadow-md sm:p-6"
        >
          <img src={codeforcesLogo} alt="Codeforces" class="h-12 w-12 object-contain" />
          <div>
            <h2 class="text-heading m-0 text-xl">Codeforces</h2>
          </div>
        </a>
        <a
          href={resolve('/submit/kattis')}
          class="bg-background border-border text-text hover:border-primary flex items-center gap-6 rounded-lg border p-4 no-underline transition-all duration-200 hover:translate-y-[-2px] hover:shadow-md sm:p-6"
        >
          <img src={kattisLogo} alt="Kattis" class="h-12 w-12 object-contain" />
          <div>
            <h2 class="text-heading m-0 text-xl">Kattis</h2>
          </div>
        </a>
      </div>
    {/if}
  </div>
</div>
