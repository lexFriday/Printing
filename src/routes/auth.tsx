import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { APP_NAME, SEO_SITE_NAME } from "@/lib/brand";
import { useAuth } from "@/hooks/useAuth";
import { Eye, EyeOff } from "lucide-react";
import { defaultLandingForRole } from "@/lib/roles";

const AUTH_LOGO_PATH = "/brand/automate-it-solutions-logo-transparent.png";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: `Sign in — ${SEO_SITE_NAME}` }] }),
  component: AuthPage,
});

function AuthPage() {
  const { user, role, loading, roleLoading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setReady(true);
    if (!loading && !roleLoading && user) {
      window.location.replace(defaultLandingForRole(role));
    }
  }, [loading, role, roleLoading, user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { display_name: name },
          },
        });
        if (error) throw error;
        toast.success("Account created. You can sign in now.");
        setMode("signin");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#f6f9ff] text-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_14%,rgba(8,117,239,0.14),transparent_30%),radial-gradient(circle_at_80%_16%,rgba(37,196,100,0.1),transparent_24%),linear-gradient(180deg,#f7fbff_0%,#f4f8ff_52%,#eef5ff_100%)]" />

      <section className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 py-6 sm:px-8 sm:py-8">
        <header className="flex justify-center pt-1 sm:justify-start sm:pt-3">
          <img
            src={AUTH_LOGO_PATH}
            alt={APP_NAME}
            className="h-auto w-[176px] object-contain sm:w-[252px]"
            width={238}
            height={57}
          />
        </header>

        <div className="flex flex-1 items-center justify-center py-6 sm:py-10">
          <div className="grid w-full max-w-5xl items-center gap-7 sm:gap-10 lg:grid-cols-[0.9fr_1fr]">
            <div className="mx-auto max-w-md text-center lg:mx-0 lg:text-left">
              <p className="mb-3 inline-flex rounded-full border border-[#0875ef]/15 bg-[#0875ef]/7 px-3 py-1.5 text-xs font-medium text-[#075fca] sm:mb-4">
                Printing management workspace
              </p>
              <h1 className="text-[40px] font-semibold leading-[0.98] tracking-[-0.045em] text-slate-950 sm:text-6xl lg:text-[64px] lg:leading-[0.96]">
                Run print operations with less rework.
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-600 sm:mt-5 sm:text-lg">
                Quotes, job orders, invoices, customers, and profitability reports in one focused
                workspace.
              </p>
              <div
                className="mt-7 hidden rounded-3xl border border-white/80 bg-white/55 p-3 shadow-[0_18px_50px_-35px_rgba(15,23,42,0.45)] backdrop-blur-xl sm:block"
                aria-label="Printing workflow"
              >
                <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-2">
                  {["Customer", "Quote", "Job", "Invoice"].map((step, index) => (
                    <div key={step} className="contents">
                      <div className="rounded-2xl bg-white/70 px-3 py-3 text-center text-sm font-medium text-slate-700 ring-1 ring-slate-200/70">
                        {step}
                      </div>
                      {index < 3 ? (
                        <div className="h-px w-5 bg-[#0875ef]/35" aria-hidden="true" />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mx-auto w-full max-w-[430px] rounded-[30px] border border-white/80 bg-white/72 p-2.5 shadow-[0_34px_100px_-50px_rgba(15,23,42,0.42)] backdrop-blur-2xl sm:rounded-[34px] sm:p-3">
              <div className="rounded-[22px] border border-slate-200/70 bg-white/82 p-4 sm:rounded-[26px] sm:p-6">
                <div className="mb-5 sm:mb-6">
                  <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                    Welcome back
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Sign in to continue to AutoMate PH.
                  </p>
                </div>

                <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
                  <TabsList className="grid h-11 w-full grid-cols-2 rounded-2xl bg-slate-100 p-1 text-slate-500">
                    <TabsTrigger
                      value="signin"
                      className="h-9 rounded-xl text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
                    >
                      Sign in
                    </TabsTrigger>
                    <TabsTrigger
                      value="signup"
                      className="h-9 rounded-xl text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
                    >
                      Create account
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="signin" className="mt-5 sm:mt-6">
                    <form onSubmit={submit} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-sm font-medium text-slate-800">
                          Email
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          required
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="h-12 rounded-2xl border-slate-200 bg-white/95 px-4 text-base shadow-none transition focus-visible:ring-2 focus-visible:ring-[#0875ef]/25"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password" className="text-sm font-medium text-slate-800">
                          Password
                        </Label>
                        <div className="relative">
                          <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            required
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="h-12 rounded-2xl border-slate-200 bg-white/95 px-4 pr-12 text-base shadow-none transition focus-visible:ring-2 focus-visible:ring-[#0875ef]/25"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((visible) => !visible)}
                            className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0875ef]/35"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            title={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>
                      <Button
                        type="submit"
                        className="mt-2 h-12 w-full rounded-2xl bg-[#0875ef] text-base font-medium shadow-[0_18px_35px_-22px_rgba(8,117,239,0.8)] transition hover:bg-[#0069dc]"
                        disabled={busy}
                      >
                        {busy ? "Signing in..." : "Sign in"}
                      </Button>
                    </form>
                  </TabsContent>

                  <TabsContent value="signup" className="mt-5 sm:mt-6">
                    <form onSubmit={submit} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name" className="text-sm font-medium text-slate-800">
                          Display name
                        </Label>
                        <Input
                          id="name"
                          required
                          autoComplete="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="h-12 rounded-2xl border-slate-200 bg-white/95 px-4 text-base shadow-none transition focus-visible:ring-2 focus-visible:ring-[#0875ef]/25"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email2" className="text-sm font-medium text-slate-800">
                          Email
                        </Label>
                        <Input
                          id="email2"
                          type="email"
                          required
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="h-12 rounded-2xl border-slate-200 bg-white/95 px-4 text-base shadow-none transition focus-visible:ring-2 focus-visible:ring-[#0875ef]/25"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password2" className="text-sm font-medium text-slate-800">
                          Password
                        </Label>
                        <div className="relative">
                          <Input
                            id="password2"
                            type={showPassword ? "text" : "password"}
                            minLength={6}
                            required
                            autoComplete="new-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="h-12 rounded-2xl border-slate-200 bg-white/95 px-4 pr-12 text-base shadow-none transition focus-visible:ring-2 focus-visible:ring-[#0875ef]/25"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((visible) => !visible)}
                            className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0875ef]/35"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            title={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>
                      <Button
                        type="submit"
                        className="mt-2 h-12 w-full rounded-2xl bg-[#0875ef] text-base font-medium shadow-[0_18px_35px_-22px_rgba(8,117,239,0.8)] transition hover:bg-[#0069dc]"
                        disabled={busy || !ready}
                      >
                        {busy ? "Creating..." : "Create account"}
                      </Button>
                      <p className="text-center text-xs leading-5 text-slate-500">
                        First account becomes admin automatically.
                      </p>
                    </form>
                  </TabsContent>
                </Tabs>
              </div>
            </div>

            <p className="text-center text-xs leading-5 text-slate-500 lg:hidden">
              Internal staff access only. Protected by workspace authentication.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
