import { NextRequest, NextResponse } from "next/server";
import { destroySession, COOKIE, sessionCookieOptions } from "@/lib/sessions";


export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  destroySession(token);
  const res = NextResponse.redirect(new URL("/login", req.url));
  const opts = sessionCookieOptions(process.env.NODE_ENV === "production");
  res.cookies.set(COOKIE, "", { ...opts, maxAge: 0 });
  return res;
}
