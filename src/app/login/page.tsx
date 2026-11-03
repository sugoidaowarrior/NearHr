import { redirect } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { resolveSession, COOKIE } from "@/lib/sessions";

// Blocking route: reads the session cookie per request (Next 16 cacheComponents).
export const instant = false;


export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const store = await cookies();
  const userId = resolveSession(store.get(COOKIE)?.value);
  if (userId) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-2xl font-bold tracking-tight">
          Hush<span className="text-emerald-400">Pay</span>
        </div>
        <p className="mt-2 text-sm text-zinc-400">
          Sign in with your Google account. New here? You&apos;ll set up a backup passphrase
          and wallet next.
        </p>

        {sp.error && (
          <div className="mt-6 rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">
            Sign-in failed: {sp.error}
            {sp.error.includes("GOOGLE_CLIENT_ID") || sp.error === "bad_state" ? (
              <div className="mt-1 text-xs text-red-400/70">
                Check that .env.local has GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and the
                redirect URI http://localhost:3000/api/auth/google/callback is registered.
              </div>
            ) : null}
          </div>
        )}

        <a
          href="/api/auth/google/start"
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 font-medium text-zinc-900 hover:bg-zinc-200"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </a>

        <p className="mt-6 text-xs text-zinc-600">
          By continuing you agree to the terms: HushPay holds your wallet keys encrypted.
          Your backup passphrase + backup email are your recovery path.
        </p>
        <Link href="/" className="mt-4 inline-block text-xs text-zinc-500 hover:text-zinc-300">
          ← Back
        </Link>
      </div>
    </main>
  );
}
