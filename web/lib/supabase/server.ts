import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(toSet) {
        try {
          for (const cookie of toSet) cookieStore.set(cookie.name, cookie.value, cookie.options);
        } catch {
          // Server Components nao podem gravar cookies; Route Handlers podem.
        }
      },
    },
  });
}
