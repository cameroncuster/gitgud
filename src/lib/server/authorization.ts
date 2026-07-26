import { json } from '@sveltejs/kit';
import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions
} from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { Database } from '$lib/types/database';

export type AuthorizedUser = {
  authorized: true;
  userId: string;
  supabase: SupabaseClient<Database>;
};

export type AuthorizationDenied = {
  authorized: false;
  response: Response;
};

export type AuthorizationResult = AuthorizedUser | AuthorizationDenied;

function bearerToken(request: Request): string {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  return match?.[1].trim() ?? '';
}

type ClientFactory = (
  supabaseUrl: string,
  supabaseKey: string,
  options?: SupabaseClientOptions<'public'>
) => SupabaseClient<Database>;

export function createAuthorization({
  createSupabaseClient
}: {
  createSupabaseClient: ClientFactory;
}) {
  async function requireUser(request: Request): Promise<AuthorizationResult> {
    const token = bearerToken(request);
    if (!token) {
      return {
        authorized: false,
        response: json({ error: 'Authentication required' }, { status: 401 })
      };
    }

    const supabase = createSupabaseClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data.user) {
        return { authorized: true, userId: data.user.id, supabase };
      }
    } catch {
      // Authentication providers fail closed.
    }
    return {
      authorized: false,
      response: json({ error: 'Invalid or expired session' }, { status: 401 })
    };
  }

  async function requireAdmin(request: Request): Promise<AuthorizationResult> {
    const auth = await requireUser(request);
    if (!auth.authorized) return auth;

    try {
      const { data, error } = await auth.supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', auth.userId)
        .single();
      if (!error && data?.role === 'admin') return auth;
    } catch {
      // Authorization lookups fail closed.
    }
    return {
      authorized: false,
      response: json({ error: 'Admin privileges required' }, { status: 403 })
    };
  }

  return { requireUser, requireAdmin };
}

export const { requireUser, requireAdmin } = createAuthorization({
  createSupabaseClient: (supabaseUrl, supabaseKey, options) =>
    createClient<Database>(supabaseUrl, supabaseKey, options)
});
