import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/integrations/firebase/client";

// TODO(supabase-strip / firebase-auth-review): This page originally used
// `supabase.auth.resetPasswordForEmail`. Replaced with Firebase Auth's
// `sendPasswordResetEmail`. Firebase sends its own templated reset email whose
// link points at the Firebase action handler (or a configured custom handler)
// carrying an `oobCode` — see reset-password.tsx. Verify the Firebase console
// email template + action URL are configured before relying on this in prod.
export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot password — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ForgotPage,
});

function ForgotPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.toLowerCase(), {
        url: `${window.location.origin}/reset-password`,
      });
      setMsg("If an account exists for that email, we sent a reset link.");
    } catch (error: unknown) {
      if (error instanceof Error) setErr(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter your email and we'll send a reset link.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {err && <p className="text-sm text-destructive">{err}</p>}
        {msg && <p className="text-sm text-accent">{msg}</p>}
        <button
          disabled={loading}
          className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
        >
          {loading ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link to="/login" className="font-medium text-accent">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
