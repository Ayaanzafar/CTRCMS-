import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError } from "@/lib/api";
import { PixelHero } from "@/components/pixel-perfect-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

const DEMO_ACCOUNTS = [
  { email: "admin@sunrack.local", role: "Admin", password: "Admin@12345" },
  { email: "warehouse@sunrack.local", role: "Warehouse", password: "Warehouse@123" },
  { email: "management@sunrack.local", role: "Management", password: "Management@123" },
];

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("warehouse@sunrack.local");
  const [password, setPassword] = useState("Warehouse@123");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    const first = user.accessibleModules[0]?.path ?? "/coil-master";
    return <Navigate to={first} replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[#050505]">
      <PixelHero
        word1="Coil"
        word2="Traceability."
        description="End-to-end traceability from AMNS dispatch through slitting, production, QC, site installation, and rust complaint investigation — for Sunrack Solar Structures."
        primaryCta="Sign In to CTRCMS"
        primaryCtaMobile="Sign In"
        secondaryCta="Visit Sunrack"
        secondaryCtaMobile="Sunrack"
        marqueeTitle="Trusted By Leading Brands"
        onPrimaryClick={() => setShowForm(true)}
        onSecondaryClick={() => window.open("https://sun-rack.com/", "_blank")}
        externalUrl="https://sun-rack.com/"
      />

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md shadow-2xl">
            <CardHeader>
              <CardTitle className="font-mono">CTRCMS Sign In</CardTitle>
              <CardDescription>Coil Traceability & Rust Complaint Management</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
                )}
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1 cursor-pointer" onClick={() => setShowForm(false)}>
                    Back
                  </Button>
                  <Button type="submit" className="flex-1 cursor-pointer" disabled={submitting}>
                    {submitting ? "Signing in…" : "Sign in"}
                  </Button>
                </div>
              </form>

              <ScrollArea className="mt-6 h-36 rounded-md border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Demo accounts</p>
                <ul className="space-y-1 text-xs">
                  {DEMO_ACCOUNTS.map((a) => (
                    <li key={a.email}>
                      <button
                        type="button"
                        className="cursor-pointer text-left hover:text-accent"
                        onClick={() => { setEmail(a.email); setPassword(a.password); }}
                      >
                        <span className="font-medium">{a.role}</span>
                        <span className="text-muted-foreground"> — {a.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Sample data: run <code className="rounded bg-muted px-1">npm run db:seed:demo</code> in backend.
                  Management login opens the <strong>Dashboard</strong> — demo coil{" "}
                  <code className="rounded bg-muted px-1">DEMO-COIL-001</code>, complaint{" "}
                  <code className="rounded bg-muted px-1">COMP-DEMO-2026-0001</code>.
                </p>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
