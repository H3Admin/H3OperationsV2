import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { auth } from "@/integrations/firebase/client";

// TODO(supabase-strip / firebase-auth-review): This page originally relied on
// Supabase putting a recovery *session* in the URL hash and calling
// `supabase.auth.updateUser({ password })`. Firebase instead delivers an
// `oobCode` query param (from the reset email / action handler) and uses
// `verifyPasswordResetCode` + `confirmPasswordReset`. Rewritten to that model.
// Verify: (1) the Firebase reset email action URL routes back to /reset-password
// with `?oobCode=...`, and (2) end-to-end reset works, before trusting in prod.
export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — H3 Operations" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ResetPage,
});

function ResetPage() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("oobCode");
    if (!code) {
      setReady(false);
      return;
    }
    // Validate the reset code before showing the form.
    verifyPasswordResetCode(auth, code)
      .then(() => {
        setOobCode(code);
        setReady(true);
      })
      .catch(() => setReady(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pw.length < 6) return setErr("Password must be at least 6 characters.");
    if (pw !== pw2) return setErr("Passwords don't match.");
    if (!oobCode) return setErr("Missing or invalid reset code.");
    setLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, pw);
      nav({ to: "/login" });
    } catch (error: unknown) {
      if (error instanceof Error) setErr(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">Set a new password</h1>
      {!ready ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Open this page from the reset link in your email.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label className="text-sm font-medium">New password</label>
            <input
              type="password"
              required
              minLength={6}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Confirm new password</label>
            <input
              type="password"
              required
              minLength={6}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <button
            disabled={loading}
            className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
          >
            {loading ? "Saving…" : "Save new password"}
          </button>
        </form>
      )}
    </div>
  );
}
