export type ModuleAccess = "NONE" | "READ" | "WRITE" | "FULL";

export interface ModuleDefinition {
  code: string;
  name: string;
  description: string;
  path: string;
  phase: number;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: {
    code: string;
    name: string;
  };
  permissions: Record<string, ModuleAccess>;
  accessibleModules: ModuleDefinition[];
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}
