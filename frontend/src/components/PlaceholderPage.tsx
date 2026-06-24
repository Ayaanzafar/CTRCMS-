import type { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  description: string;
  moduleCode: string;
  features?: string[];
  children?: ReactNode;
}

export function PlaceholderPage({
  title,
  description,
  moduleCode,
  features = [],
  children,
}: PlaceholderPageProps) {
  const { canWrite } = useAuth();
  const writeAccess = canWrite(moduleCode);

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title={title}
        description={description}
        actions={
          <Badge variant={writeAccess ? "default" : "secondary"}>
            {writeAccess ? "Read & Write" : "Read Only"}
          </Badge>
        }
      />

      {features.length > 0 && (
        <Card className="mb-8">
          <CardContent className="pt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Planned Features
            </h2>
            <ul className="mt-4 space-y-2">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {children}

      <Card className="border-dashed">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground">
            This module is not yet available. Uses shadcn/ui + 21st.dev design system per{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">design-system/MASTER.md</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
