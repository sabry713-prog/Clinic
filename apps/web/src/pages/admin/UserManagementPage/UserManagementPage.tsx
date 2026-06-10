/**
 * UserManagementPage — hospital admin user management.
 *
 * Constraints:
 * - No color-coding of roles or status
 * - Plain factual display
 */

import { useState, useEffect, useCallback } from "react";
import { api, type AdminUser, ApiError } from "../../../lib/api";

const ALL_ROLES = ["physician", "pharmacist", "nurse", "hospital_admin", "sysadmin"];

interface EditModalProps {
  user: AdminUser;
  onClose: () => void;
  onSave: (userId: string, roles: string[]) => void;
}

function EditModal({ user, onClose, onSave }: EditModalProps): JSX.Element {
  const [selectedRoles, setSelectedRoles] = useState<string[]>([...user.roles]);

  const toggleRole = (role: string): void => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-white font-semibold">Edit roles for {user.display_name}</h2>

        <div className="space-y-2">
          {ALL_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-3 text-sm text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedRoles.includes(role)}
                onChange={() => toggleRole(role)}
                className="rounded"
              />
              {role}
            </label>
          ))}
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => onSave(user.id, selectedRoles)}
            className="bg-white text-slate-950 text-sm px-4 py-2 rounded hover:bg-slate-200"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="border border-slate-700 text-white text-sm px-4 py-2 rounded hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UserManagementPage(): JSX.Element {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [disableConfirm, setDisableConfirm] = useState<string | null>(null);

  const loadUsers = useCallback((): void => {
    setIsLoading(true);
    api.admin
      .listUsers({ limit: 50 })
      .then((data) => setUsers(data.data))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Failed to load users");
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleSaveRoles = (userId: string, roles: string[]): void => {
    api.admin
      .updateUserRoles(userId, roles)
      .then(() => {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, roles } : u)),
        );
        setEditingUser(null);
      })
      .catch((err: unknown) => {
        alert(err instanceof ApiError ? err.message : "Failed to update roles");
      });
  };

  const handleDisable = (userId: string): void => {
    api.admin
      .disableUser(userId)
      .then(() => {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, disabled_at: new Date().toISOString() } : u,
          ),
        );
        setDisableConfirm(null);
      })
      .catch((err: unknown) => {
        alert(err instanceof ApiError ? err.message : "Failed to disable user");
      });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading users...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-lg font-semibold">User Management</h1>

        {error && <p className="text-slate-400 text-sm">{error}</p>}

        <div className="bg-slate-900 rounded-xl overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Roles</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-white">{user.display_name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-300">{user.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((role) => (
                        <span
                          key={role}
                          className="text-xs border border-slate-600 rounded px-2 py-0.5 text-slate-300"
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {user.disabled_at ? `Disabled ${new Date(user.disabled_at).toLocaleDateString()}` : "Active"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {!user.disabled_at && (
                        <>
                          <button
                            onClick={() => setEditingUser(user)}
                            className="text-xs text-slate-400 hover:text-white border border-slate-700 rounded px-2 py-1"
                          >
                            Edit roles
                          </button>
                          <button
                            onClick={() => setDisableConfirm(user.id)}
                            className="text-xs text-slate-400 hover:text-white border border-slate-700 rounded px-2 py-1"
                          >
                            Disable
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {users.length === 0 && (
            <p className="text-slate-500 text-sm p-4">No users found.</p>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editingUser && (
        <EditModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={handleSaveRoles}
        />
      )}

      {/* Disable confirmation */}
      {disableConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-sm space-y-4">
            <p className="text-white text-sm">
              Are you sure you want to disable this user? This action cannot be undone via the UI.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDisable(disableConfirm)}
                className="bg-white text-slate-950 text-sm px-4 py-2 rounded"
              >
                Confirm disable
              </button>
              <button
                onClick={() => setDisableConfirm(null)}
                className="border border-slate-700 text-white text-sm px-4 py-2 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
