import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Compatible deep link: /submit/kattis preselects the Kattis provider in the
// unified /submit workspace. Preserved as a stable, bookmarkable route.
export const load: PageLoad = () => {
  redirect(307, '/submit?provider=kattis');
};
