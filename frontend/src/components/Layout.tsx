import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  CircleDot,
  Scissors,
  Package,
  Factory,
  ClipboardList,
  Truck,
  ShieldCheck,
  HardHat,
  AlertTriangle,
  Link2,
  Paperclip,
  Users,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const MODULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  "coil-master": CircleDot,
  slitting: Scissors,
  "sunrack-receipt": Package,
  production: Factory,
  "finished-goods": ClipboardList,
  "qc-inspection": ShieldCheck,
  dispatch: Truck,
  "site-installation": HardHat,
  complaint: AlertTriangle,
  traceability: Link2,
  documents: Paperclip,
  "users-roles": Users,
};

export function Sidebar() {
  const { user, logout } = useAuth();
  const modules = user?.accessibleModules ?? [];

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Sunrack Solar
        </p>
        <h1 className="mt-1 font-mono text-lg font-bold">CTRCMS</h1>
        <p className="mt-1 text-xs text-sidebar-foreground/60">
          Coil Traceability System
        </p>
      </div>

      <Separator className="bg-sidebar-border" />

      <ScrollArea className="flex-1 px-3 py-4">
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40">
          Modules
        </p>
        <ul className="space-y-1">
          {modules.map((mod) => {
            const Icon = MODULE_ICONS[mod.code] ?? CircleDot;
            return (
              <li key={mod.code}>
                <NavLink
                  to={mod.path}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{mod.name}</span>
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      <div className="border-t border-sidebar-border px-5 py-4">
        <p className="truncate text-sm font-medium">{user?.fullName}</p>
        <p className="truncate text-xs text-sidebar-foreground/60">{user?.role.name}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full cursor-pointer border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={() => logout()}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

export function ModuleGuard({
  moduleCode,
  children,
}: {
  moduleCode: string;
  children: React.ReactNode;
}) {
  const { hasModuleAccess } = useAuth();

  if (!hasModuleAccess(moduleCode)) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center">
          <h2 className="text-lg font-semibold text-destructive">Access Denied</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your role does not have permission to view this module.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
