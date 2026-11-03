import { redirect } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { resolveSession, COOKIE } from "@/lib/sessions";
import { ThemeToggle } from "@/components/theme-toggle";

// Blocking route: reads the session cookie per request (Next 16 cacheComponents).
export const instant = false;

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const store = await cookies();
  const userId = resolveSession(store.get(COOKIE)?.value);
  if (userId) redirect("/dashboard");

  return (
    <main className="min-h-screen overflow-x-clip">
      <div className="landing-nav">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-[#4d65ff] to-[#0082f3] text-sm font-extrabold text-white">
            N
          </span>
          <span className="text-[15px] font-bold tracking-tight">NearHr</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/" className="nav-link">
            Back to site
          </Link>
          <ThemeToggle compact />
        </div>
      </div>

      <div className="flex min-h-screen items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="glass p-7 sm:p-9">
            <div className="mb-6 flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-gradient-to-br from-[#4d65ff] to-[#0082f3] text-lg font-extrabold text-white">
                N
              </span>
              <div>
                <div className="text-[15px] font-bold tracking-tight">Welcome to NearHr</div>
                <div className="text-[11.5px] text-[var(--color-faint)]">Sign in to your payroll workspace</div>
              </div>
            </div>

            <h1 className="font-[var(--font-display)] text-[clamp(30px,4vw,40px)] font-bold leading-[1.02] tracking-[-0.03em]">
              Your payroll,
              <br />
              <span className="display-grad">one sign in.</span>
            </h1>
            <p className="mt-4 text-[14px] leading-relaxed text-[var(--color-muted)]">
              Sign in with your Google account. Your private payroll wallet is created
              automatically and nothing else is required.
            </p>

            {sp.error ? (
              <div className="mt-6 border border-[var(--color-danger)] bg-[rgba(239,68,68,0.08)] p-4 text-[13px] text-[#f87171]">
                Sign in failed: {sp.error}
                {sp.error.includes("GOOGLE_CLIENT_ID") || sp.error === "bad_state" ? (
                  <div className="mt-2 text-[12px] opacity-70">
                    Check that .env.local has GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and the
                    redirect URI http://localhost:3000/api/auth/google/callback is registered.
                  </div>
                ) : null}
              </div>
            ) : null}

            <a href="/api/auth/google/start" className="btn btn-primary mt-7 w-full !py-4">
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              Continue with Google
            </a>

            <p className="mt-6 text-[12px] leading-relaxed text-[var(--color-faint)]">
              NearHr holds your wallet keys encrypted. No seed phrases and no passphrases.
              Sign in with Google and go.
            </p>
          </div>
          <div className="mt-5 flex items-center justify-between text-[11px] text-[var(--color-faint)]">
            <span>NEAR PROTOCOL · MAINNET</span>
            <span>CUSTODIAL SMART ACCOUNT</span>
          </div>
        </div>
      </div>
    </main>
  );
}
