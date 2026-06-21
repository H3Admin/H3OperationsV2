import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createUserWithEmailAndPassword, updateProfile, type User } from "firebase/auth";
import { auth } from "@/integrations/firebase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create account — H3 Operations" },
      { name: "description", content: "Create your H3 Operations account." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [claimsLoading, setClaimsLoading] = useState(false);

  const pollForClaims = async (currentUser: User, maxRetries = 10, delay = 1500) => {
    for (let i = 0; i < maxRetries; i++) {
      await currentUser.getIdToken(true); // Force refresh
      const idTokenResult = await currentUser.getIdTokenResult();
      if (idTokenResult.claims.accountId) {
        return true; // Claims are present
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return false; // Claims not found after retries
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const normalizedEmail = email.toLowerCase();

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      const currentUser = userCredential.user;
      await updateProfile(currentUser, { displayName: fullName });
      setLoading(false);
      setClaimsLoading(true);

      const claimsFound = await pollForClaims(currentUser);
      if (claimsFound) {
        setClaimsLoading(false);
        nav({ to: "/account" as any });
      } else {
        setClaimsLoading(false);
        setErr("Could not initialize your account. Please try logging in.");
        auth.signOut();
      }
    } catch (error: unknown) {
      setLoading(false);
      if (error instanceof Error) {
        setErr(error.message);
      }
    }
  };

  if (user && !claimsLoading) {
    nav({ to: "/account" as any });
    return null;
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="mt-2 text-sm text-muted-foreground">Start managing your business with H3 Operations.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <div>
          <label className="text-sm font-medium">Your name</label>
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Password</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {(loading || claimsLoading) && (
          <div className="text-center text-sm text-muted-foreground">
            <p>{loading ? "Creating account..." : "Initializing your account..."}</p>
          </div>
        )}
        <button
          disabled={loading || claimsLoading}
          className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
        >
          Create account
        </button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent">
          Sign in
        </Link>
      </p>
    </div>
  );
}
