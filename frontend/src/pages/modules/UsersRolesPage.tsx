import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Shield,
  Users,
  Pencil,
  UserX,
  RotateCcw,
  Save,
  Lock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usersRolesApi, ApiError } from "@/lib/api";
import type {
  ModuleAccessLevel,
  RoleRecord,
  UserRecord,
} from "@/types/users-roles";
import { ACCESS_LEVEL_LABELS } from "@/types/users-roles";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Tab = "users" | "permissions";

const ACCESS_LEVELS: ModuleAccessLevel[] = ["NONE", "READ", "WRITE", "FULL"];

const EMPTY_USER_FORM = {
  email: "",
  password: "",
  fullName: "",
  roleCode: "PRODUCTION",
};

export function UsersRolesPage() {
  const { token, canWrite, canFullAccess, user: currentUser } = useAuth();
  const canManage = canFullAccess("users-roles");

  const [tab, setTab] = useState<Tab>("users");
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [userForm, setUserForm] = useState(EMPTY_USER_FORM);
  const [userFormError, setUserFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [selectedRoleCode, setSelectedRoleCode] = useState("QC");
  const [permissions, setPermissions] = useState<Record<string, ModuleAccessLevel>>(
    {}
  );
  const [modulesByPhase, setModulesByPhase] = useState<
    Array<{
      phase: number;
      modules: Array<{ code: string; name: string; description: string }>;
    }>
  >([]);
  const [permLoading, setPermLoading] = useState(false);
  const [permSaving, setPermSaving] = useState(false);
  const [permMessage, setPermMessage] = useState("");

  const selectedRole = useMemo(
    () => roles.find((r) => r.code === selectedRoleCode),
    [roles, selectedRoleCode]
  );

  const isAdminRole = selectedRoleCode === "ADMIN";

  const permissionModules = useMemo(
    () => modulesByPhase.flatMap((group) => group.modules),
    [modulesByPhase]
  );

  const loadUsersAndRoles = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [rolesRes, usersRes] = await Promise.all([
        usersRolesApi.listRoles(token),
        usersRolesApi.listUsers(token),
      ]);
      setRoles(rolesRes.roles);
      setUsers(usersRes.users);
    } catch (err) {
      setError(err instanceof ApiError ? String(err.message) : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadPermissions = useCallback(async () => {
    if (!token || !selectedRoleCode) return;
    setPermLoading(true);
    setPermMessage("");
    try {
      const res = await usersRolesApi.getRolePermissions(token, selectedRoleCode);
      setPermissions(res.role.permissions);
      setModulesByPhase(res.modulesByPhase);
    } catch (err) {
      setPermMessage(
        err instanceof ApiError ? String(err.message) : "Failed to load permissions"
      );
    } finally {
      setPermLoading(false);
    }
  }, [token, selectedRoleCode]);

  useEffect(() => {
    loadUsersAndRoles();
  }, [loadUsersAndRoles]);

  useEffect(() => {
    if (tab === "permissions") loadPermissions();
  }, [tab, loadPermissions]);

  function openCreateUser() {
    setEditingUser(null);
    setUserForm(EMPTY_USER_FORM);
    setUserFormError("");
    setUserDialogOpen(true);
  }

  function openEditUser(u: UserRecord) {
    setEditingUser(u);
    setUserForm({
      email: u.email,
      password: "",
      fullName: u.fullName,
      roleCode: u.role.code,
    });
    setUserFormError("");
    setUserDialogOpen(true);
  }

  async function handleUserSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !canManage) return;
    setUserFormError("");
    setSubmitting(true);
    try {
      if (editingUser) {
        const payload: {
          email?: string;
          password?: string;
          fullName?: string;
          roleCode?: string;
        } = {
          email: userForm.email,
          fullName: userForm.fullName,
          roleCode: userForm.roleCode,
        };
        if (userForm.password) payload.password = userForm.password;
        await usersRolesApi.updateUser(token, editingUser.id, payload);
      } else {
        await usersRolesApi.createUser(token, userForm);
      }
      setUserDialogOpen(false);
      await loadUsersAndRoles();
    } catch (err) {
      setUserFormError(
        err instanceof ApiError ? String(err.message) : "Failed to save user"
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(u: UserRecord) {
    if (!token || !canManage) return;
    if (!window.confirm(`Deactivate ${u.fullName}? They will no longer be able to log in.`)) {
      return;
    }
    try {
      await usersRolesApi.deactivateUser(token, u.id);
      await loadUsersAndRoles();
    } catch (err) {
      alert(err instanceof ApiError ? String(err.message) : "Failed to deactivate user");
    }
  }

  function setModuleAccess(moduleCode: string, access: ModuleAccessLevel) {
    setPermissions((prev) => ({ ...prev, [moduleCode]: access }));
  }

  async function handleSavePermissions() {
    if (!token || !canManage || isAdminRole) return;
    setPermSaving(true);
    setPermMessage("");
    try {
      await usersRolesApi.updateRolePermissions(token, selectedRoleCode, permissions);
      setPermMessage("Permissions saved.");
      await loadPermissions();
    } catch (err) {
      setPermMessage(
        err instanceof ApiError ? String(err.message) : "Failed to save permissions"
      );
    } finally {
      setPermSaving(false);
    }
  }

  async function handleResetPermissions() {
    if (!token || !canManage || isAdminRole) return;
    if (!window.confirm(`Reset ${selectedRole?.name ?? selectedRoleCode} to default permissions?`)) {
      return;
    }
    setPermSaving(true);
    setPermMessage("");
    try {
      const res = await usersRolesApi.resetRolePermissions(token, selectedRoleCode);
      setPermissions(res.role.permissions);
      setPermMessage("Permissions reset to defaults.");
    } catch (err) {
      setPermMessage(
        err instanceof ApiError ? String(err.message) : "Failed to reset permissions"
      );
    } finally {
      setPermSaving(false);
    }
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Users & Roles"
        description="Manage user accounts and configure module-level permissions (None / Read / Write / Full) for each role."
        actions={
          tab === "users" && canManage ? (
            <Button onClick={openCreateUser} className="cursor-pointer">
              <Plus className="mr-2 h-4 w-4" />
              Add user
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6 flex gap-2 border-b border-border pb-2">
        <Button
          variant={tab === "users" ? "default" : "ghost"}
          onClick={() => setTab("users")}
          className="cursor-pointer"
        >
          <Users className="mr-2 h-4 w-4" />
          Users ({users.length})
        </Button>
        <Button
          variant={tab === "permissions" ? "default" : "ghost"}
          onClick={() => setTab("permissions")}
          className="cursor-pointer"
        >
          <Shield className="mr-2 h-4 w-4" />
          Role permissions
        </Button>
      </div>

      {error && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {tab === "users" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">User accounts</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading users…</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && <TableHead className="w-28">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.fullName}</TableCell>
                      <TableCell className="text-muted-foreground">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{u.role.name}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.isActive ? "default" : "outline"}>
                          {u.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditUser(u)}
                              title="Edit user"
                              className="cursor-pointer"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {u.isActive && u.id !== currentUser?.id && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeactivate(u)}
                                title="Deactivate user"
                                className="cursor-pointer text-destructive hover:text-destructive"
                              >
                                <UserX className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!canManage && canWrite("users-roles") && (
              <p className="mt-4 text-xs text-muted-foreground">
                You have read-only access. FULL access is required to create or edit users.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "permissions" && (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full max-w-sm">
              <Label>Role</Label>
              <Select value={selectedRoleCode} onValueChange={setSelectedRoleCode}>
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.name} ({r._count.users} user{r._count.users === 1 ? "" : "s"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canManage && !isAdminRole && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleResetPermissions}
                  disabled={permSaving}
                  className="cursor-pointer"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset defaults
                </Button>
                <Button
                  onClick={handleSavePermissions}
                  disabled={permSaving || permLoading}
                  className="cursor-pointer"
                >
                  <Save className="mr-2 h-4 w-4" />
                  Save permissions
                </Button>
              </div>
            )}
          </div>

          {isAdminRole && (
            <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Admin role is locked</p>
                <p className="mt-1 text-brand-800">
                  Admin always has FULL access (create, edit, delete) on every module.
                  This cannot be changed.
                </p>
              </div>
            </div>
          )}

          {permMessage && (
            <p
              className={`rounded-md px-3 py-2 text-sm ${
                permMessage.includes("Failed")
                  ? "bg-destructive/10 text-destructive"
                  : "bg-emerald-50 text-emerald-800"
              }`}
            >
              {permMessage}
            </p>
          )}

          {permLoading ? (
            <p className="text-sm text-muted-foreground">Loading permissions…</p>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Module permissions ({permissionModules.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Module</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-44">Access</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {permissionModules.map((mod) => {
                      const access = permissions[mod.code] ?? "NONE";
                      return (
                        <TableRow key={mod.code}>
                          <TableCell className="font-medium">{mod.name}</TableCell>
                          <TableCell className="max-w-md text-sm text-muted-foreground">
                            {mod.description}
                          </TableCell>
                          <TableCell>
                            {isAdminRole ? (
                              <Badge>FULL</Badge>
                            ) : canManage ? (
                              <Select
                                value={access}
                                onValueChange={(v) =>
                                  setModuleAccess(mod.code, v as ModuleAccessLevel)
                                }
                              >
                                <SelectTrigger className="cursor-pointer">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ACCESS_LEVELS.map((level) => (
                                    <SelectItem key={level} value={level}>
                                      {ACCESS_LEVEL_LABELS[level].label} —{" "}
                                      {ACCESS_LEVEL_LABELS[level].description}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant="outline">{access}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit user" : "Create user"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUserSubmit} className="grid gap-4">
            {userFormError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {userFormError}
              </p>
            )}
            <div>
              <Label htmlFor="fullName">Full name *</Label>
              <Input
                id="fullName"
                value={userForm.fullName}
                onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="password">
                Password {editingUser ? "(leave blank to keep)" : "*"}
              </Label>
              <Input
                id="password"
                type="password"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                required={!editingUser}
                minLength={8}
              />
            </div>
            <div>
              <Label>Role *</Label>
              <Select
                value={userForm.roleCode}
                onValueChange={(v) => setUserForm({ ...userForm, roleCode: v })}
              >
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUserDialogOpen(false)}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="cursor-pointer">
                {submitting ? "Saving…" : editingUser ? "Save changes" : "Create user"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
