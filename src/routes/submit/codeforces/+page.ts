import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Compatible deep link: /submit/codeforces preselects the Codeforces provider in
// the unified /submit workspace. Preserved as a stable, bookmarkable route.
export const load: PageLoad = () => {
  redirect(307, '/submit?provider=codeforces');
};
