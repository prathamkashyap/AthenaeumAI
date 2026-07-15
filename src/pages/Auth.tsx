import { StarryBackground } from "@/components/StarryBackground";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle, GraduationCap, Loader2, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

const Auth = () => {
  const { isAuthenticated, login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || "/";

  if (isAuthenticated) return <Navigate to={from} replace />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await signup({
          name: String(form.get("name") || ""),
          email,
          password,
          program: String(form.get("program") || ""),
          semester: String(form.get("semester") || ""),
        });
      }
      navigate(from, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <StarryBackground />
      <div className="relative z-10 min-h-screen grid lg:grid-cols-[1fr_440px]">
        <section className="hidden lg:flex flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center shadow-glow">
              <GraduationCap className="h-6 w-6 text-accent" />
            </div>
            <div>
              <p className="font-serif text-2xl leading-none">AthenaeumAI</p>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mt-1">Intelligent Learning OS</p>
            </div>
          </div>

          <div className="max-w-3xl space-y-6">
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-accent">
              <Sparkles className="h-3.5 w-3.5" /> Adaptive mastery engine
            </div>
            <h1 className="font-serif text-6xl leading-[1.08]">
              Build a study system that remembers how you learn.
            </h1>
            <p className="text-muted-foreground max-w-xl">
              Upload material, generate exam-style assessments, track weak topics, and turn every attempt into a personalized revision loop.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">Groq-powered generation with backend-verified progress tracking.</p>
        </section>

        <section className="flex items-center justify-center p-6">
          <Card className="academic-card w-full max-w-md p-6">
            <div className="mb-6 lg:hidden flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
                <GraduationCap className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="font-serif text-xl">AthenaeumAI</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Learning OS</p>
              </div>
            </div>

            <Tabs value={mode} onValueChange={setMode}>
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="login">Login</TabsTrigger>
                <TabsTrigger value="signup">Signup</TabsTrigger>
              </TabsList>

              <form onSubmit={handleSubmit} className="space-y-4">
                <TabsContent value="login" className="mt-0 space-y-4">
                  <div>
                    <h2 className="font-serif text-2xl">Welcome back</h2>
                    <p className="text-sm text-muted-foreground mt-1">Resume your adaptive learning workspace.</p>
                  </div>
                </TabsContent>

                <TabsContent value="signup" className="mt-0 space-y-4">
                  <div>
                    <h2 className="font-serif text-2xl">Create your workspace</h2>
                    <p className="text-sm text-muted-foreground mt-1">Your quizzes, materials, and mastery map stay connected.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" name="name" placeholder="Pratham Kashyap" required={mode === "signup"} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="program">Program</Label>
                      <Input id="program" name="program" placeholder="B.Tech" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="semester">Semester</Label>
                      <Input id="semester" name="semester" placeholder="Sem 6" />
                    </div>
                  </div>
                </TabsContent>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" placeholder="you@example.com" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" name="password" type="password" minLength={8} required />
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button className="w-full bg-accent text-primary-foreground hover:bg-accent/90" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "login" ? "Enter Workspace" : "Create Workspace"}
                </Button>
              </form>
            </Tabs>
          </Card>
        </section>
      </div>
    </div>
  );
};

export default Auth;
