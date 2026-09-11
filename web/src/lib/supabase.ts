import { createClient } from '@supabase/supabase-js'

/**
 * These two values are public by design. The publishable key ships inside the
 * browser bundle on every deploy no matter where it is configured, and
 * row-level security - not secrecy of this key - is what protects the data.
 *
 * Baking them in as defaults means the app deploys anywhere with zero
 * configuration. Set the env vars to point a build at a different project.
 *
 * The service_role key is a different thing entirely: it bypasses RLS and must
 * never appear in this file or anywhere else in the client.
 */
const DEFAULT_URL = 'https://bmnhxvdnvytdrpqgvxts.supabase.co'
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_DhV-wf6jKQ9dcVpE0kI7HA_xIEnLjCq'

const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})
