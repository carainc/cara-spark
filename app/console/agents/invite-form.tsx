import type { Role } from '@prisma/client';
import { grantableRoles } from '@/lib/auth/roles';
import { createInviteAction } from './actions';

/** Invite form — only the roles the actor may grant are offered (no privilege escalation). */
export function InviteForm({ actorRole }: { actorRole: Role | undefined | null }) {
  const roles = grantableRoles(actorRole);
  return (
    <form action={createInviteAction} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-sm">
        <span className="mb-1 text-gray-700">Email</span>
        <input
          type="email"
          name="email"
          required
          placeholder="colleague@example.org"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col text-sm">
        <span className="mb-1 text-gray-700">Role</span>
        <select name="role" defaultValue="EDITOR" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
      >
        Send invite
      </button>
    </form>
  );
}
