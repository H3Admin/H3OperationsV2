import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc, type Timestamp } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/account/team")({
  component: TeamPage,
});

interface Member {
  uid: string;
  name?: string;
  email?: string;
  role: string;
  joinedAt: Timestamp | null;
}

function TeamPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<string | null>(null);

  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const idTokenResult = await user.getIdTokenResult();
        const claimedAccountId = idTokenResult.claims.accountId as string | undefined;
        const claimedRole = idTokenResult.claims.role as string | undefined;
        if (!claimedAccountId) {
          if (!cancelled) setErr("No account found for this user.");
          return;
        }
        if (!cancelled) {
          setAccountId(claimedAccountId);
          setCurrentRole(claimedRole ?? null);
        }

        const snap = await getDocs(collection(db, "accounts", claimedAccountId, "members"));
        if (!cancelled) {
          setMembers(
            snap.docs.map((d) => {
              const data = d.data();
              return {
                uid: d.id,
                name: data.name,
                email: data.email,
                role: data.role,
                joinedAt: data.joinedAt ?? null,
              };
            }),
          );
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setErr(error instanceof Error ? error.message : "Failed to load team.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const canManageRoles = currentRole === "owner" || currentRole === "admin";

  const onRoleChange = async (memberUid: string, newRole: string) => {
    if (!accountId) return;
    try {
      await updateDoc(doc(db, "accounts", accountId, "members", memberUid), { role: newRole });
      setMembers((prev) => prev.map((m) => (m.uid === memberUid ? { ...m, role: newRole } : m)));
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Failed to update role.");
    }
  };

  const onInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !accountId) return;
    setInviteSaving(true);
    setInviteErr(null);
    setInviteSuccess(false);

    try {
      await addDoc(collection(db, "invites"), {
        email: inviteEmail.toLowerCase(),
        accountId,
        role: inviteRole,
        status: "pending",
        createdAt: serverTimestamp(),
        invitedBy: user.uid,
      });
      setInviteSuccess(true);
      setInviteEmail("");
      setInviteRole("member");
    } catch (error: unknown) {
      setInviteErr(error instanceof Error ? error.message : "Failed to send invite.");
    } finally {
      setInviteSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Team</h1>
        <button
          onClick={() => setInviting((v) => !v)}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
        >
          {inviting ? "Cancel" : "Invite Member"}
        </button>
      </div>

      {inviting && (
        <form onSubmit={onInviteSubmit} className="mt-6 max-w-md space-y-4 rounded-md border border-input p-4">
          <div>
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {inviteErr && <p className="text-sm text-destructive">{inviteErr}</p>}
          {inviteSuccess && <p className="text-sm text-accent">Invite sent.</p>}
          <button
            disabled={inviteSaving}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-60"
          >
            {inviteSaving ? "Sending…" : "Send invite"}
          </button>
        </form>
      )}

      {loading && <p className="mt-8 text-sm text-muted-foreground">Loading…</p>}
      {err && <p className="mt-8 text-sm text-destructive">{err}</p>}

      {!loading && !err && (
        <table className="mt-8 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-input text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="py-2 pr-4 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isSelf = member.uid === user?.uid;
              const canEditThisRole = canManageRoles && !isSelf && member.role !== "owner";
              return (
                <tr key={member.uid} className="border-b border-input">
                  <td className="py-2 pr-4">{member.name ?? "—"}</td>
                  <td className="py-2 pr-4">{member.email ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {canEditThisRole ? (
                      <select
                        value={member.role}
                        onChange={(e) => onRoleChange(member.uid, e.target.value)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span className="capitalize">{member.role}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{member.joinedAt ? member.joinedAt.toDate().toLocaleDateString() : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
