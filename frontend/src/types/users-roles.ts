export type ModuleAccessLevel = "NONE" | "READ" | "WRITE" | "FULL";

export interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
  role: { code: string; name: string };
}

export interface RoleRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  _count: { users: number };
  permissions?: Array<{ module: string; access: ModuleAccessLevel }>;
}

export interface ModuleByPhase {
  phase: number;
  modules: Array<{
    code: string;
    name: string;
    description: string;
    path: string;
    phase: number;
  }>;
}

export interface RolePermissionsResponse {
  role: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    permissions: Record<string, ModuleAccessLevel>;
  };
  modulesByPhase: ModuleByPhase[];
}

export const ACCESS_LEVEL_LABELS: Record<
  ModuleAccessLevel,
  { label: string; description: string }
> = {
  NONE: { label: "None", description: "No access" },
  READ: { label: "Read", description: "View only" },
  WRITE: { label: "Write", description: "Create & edit" },
  FULL: { label: "Full", description: "Create, edit & delete" },
};
