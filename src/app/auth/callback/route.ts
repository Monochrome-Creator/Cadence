import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/utils/supabase/server";

/**
 * Magic-link / email-confirmation landing route. Supabase redirects here with a
 * `?code=...`; we exchange it for a session (which sets the auth cookies) and
 * then forward the user to their intended destination.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  // Something went wrong (expired link, missing code, or no client).
  return NextResponse.redirect(`${origin}/login?error=link`);
}
