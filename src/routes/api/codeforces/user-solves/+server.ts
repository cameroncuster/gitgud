import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { extractCodeforcesSolvedUrls } from '$lib/services/userSolves';

export const GET: RequestHandler = async ({ url, fetch }) => {
  const handle = url.searchParams.get('handle')?.trim();
  if (!handle) {
    return json({ error: 'No handle provided' }, { status: 400 });
  }

  try {
    const response = await fetch(
      `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}`
    );
    const data = await response.json();

    if (data.status !== 'OK') {
      if (typeof data.comment === 'string' && data.comment.includes('not found')) {
        return json({ error: `User ${handle} not found on Codeforces` }, { status: 404 });
      }
      return json(
        { error: data.comment || 'Failed to fetch submissions from Codeforces' },
        { status: 502 }
      );
    }

    return json({ solvedUrls: extractCodeforcesSolvedUrls(data.result) });
  } catch (error) {
    console.error('Error fetching Codeforces submissions:', error);
    return json({ error: 'Failed to fetch submissions from Codeforces' }, { status: 500 });
  }
};
