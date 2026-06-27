import { createBrowserClient } from "@supabase/ssr";

// Browser-side client (login form, future realtime). The same supabase-js client
// is what the eventual React Native apps will use.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
