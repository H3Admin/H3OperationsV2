import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { updateProfile } from "firebase/auth";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/account/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setErr(null);
    setSuccess(false);

    try {
      await updateProfile(user, { displayName });
      setSuccess(true);
    } catch (error: unknown) {
      if (error instanceof Error) {
        setErr(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold">Profile</h1>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <div>
          <label className="text-sm font-medium">Name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Email</label>
          <input
            value={user?.email ?? ""}
            disabled
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground"
          />
        </div>

        {err && <p className="text-sm text-destructive">{err}</p>}
        {success && <p className="text-sm text-accent">Profile updated.</p>}

        <button
          disabled={saving}
          className="rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
