import { NextResponse, type NextRequest } from "next/server";

// Auth gate for /dashboard: no valid session cookie -> /login.
// Middleware runs on every request, so this works even with PPR/cacheComponents
// (a layout-level cookies() guard would break build-time prerendering).
export function middleware(req: NextRequest) {
  const token = req.cookies.get("hp_session")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  // A real session lookup happens in the API routes; here we only gate the
  // page shell. (Expired/invalid tokens 401 at the API layer and the client
  // bounces to /login.)
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard"],
};
