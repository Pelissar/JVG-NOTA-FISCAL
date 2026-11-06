import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

/** The static ERP shell must not be accessible without a valid session. */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.redirect(new URL("/login", request.url));

  let response = NextResponse.next({ request });
  const client = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(toSet) {
        for (const cookie of toSet) request.cookies.set(cookie.name, cookie.value);
        response = NextResponse.next({ request });
        for (const cookie of toSet) response.cookies.set(cookie.name, cookie.value, cookie.options);
      },
    },
  });

  try {
    const { data, error } = await client.auth.getClaims();
    if (!error && data?.claims) return response;
  } catch {
    // An unavailable auth provider must not accidentally expose the ERP shell.
  }

  const redirect = NextResponse.redirect(new URL("/login", request.url));
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie.name, cookie.value);
  return redirect;
}

export const config = { matcher: ["/erp/:path*"] };
