import { json } from '@sveltejs/kit';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';

export type AuthorizedUser = {
  authorized: true;
  userId: string;
  supabase: SupabaseClient;
};

export type AuthorizationDenied = {
  authorized: false;
  response: Response;
};

export type AuthorizationResult = AuthorizedUser | AuthorizationDenied;

function bearerToken(request: Request): string {
  return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

export async function requireUser(request: Request): Promise<AuthorizationResult> {
  const token = bearerToken(request);
  if (!token) {
    return {
      authorized: false,
      response: json({ error: 'Authentication required' }, { status: 401 })
    };
  }

  const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return {
      authorized: false,
      response: json({ error: 'Invalid or expired session' }, { status: 401 })
    };
  }

  return { authorized: true, userId: data.user.id, supabase };
}

export async function requireAdmin(request: Request): Promise<AuthorizationResult> {
  const auth = await requireUser(request);
  if (!auth.authorized) return auth;

  const { data, error } = await auth.supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', auth.userId)
    .single();
  if (error || data?.role !== 'admin') {
    return {
      authorized: false,
      response: json({ error: 'Admin privileges required' }, { status: 403 })
    };
  }

  return auth;
}
