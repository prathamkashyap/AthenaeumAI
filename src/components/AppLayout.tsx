import { ReactNode, useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { StarryBackground } from "./StarryBackground";
import { ThemeToggle } from "./ThemeToggle";
import { Search, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { NotificationBell } from "./NotificationBell";
import { Link } from "react-router-dom";

export function AppLayout({ children }: { children: ReactNode }) {
  const [showTop, setShowTop] = useState(false);
  const { user, logout } = useAuth();

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <SidebarProvider>
      <StarryBackground />
      <div className="min-h-screen flex w-full bg-transparent relative z-10">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-40 h-16 flex items-center border-b border-border bg-background/60 backdrop-blur-xl px-6">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            </div>

            <div className="hidden md:flex flex-1 justify-center">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search topics, PYQs, flashcards…"
                  className="pl-9 h-9 bg-muted/40 border-border/60 focus-visible:ring-accent/40"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <ThemeToggle />
              <NotificationBell />
              <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-border">
                <div className="text-right">
                  <Link to="/profile" className="text-xs font-medium leading-tight hover:text-accent block">
                    {user?.name || "Learner"}
                  </Link>
                  <button
                    onClick={logout}
                    className="text-[10px] text-muted-foreground hover:text-accent leading-tight"
                  >
                    Sign out
                  </button>
                </div>
                <Link to="/profile" className="h-8 w-8 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center text-[11px] font-semibold text-accent hover:bg-accent/25 transition-colors cursor-pointer">
                  {(user?.name || "AI").split(" ").map((part: string) => part[0]).join("").slice(0, 2).toUpperCase()}
                </Link>
              </div>
            </div>
          </header>

          <main className="flex-1 animate-fade-in">{children}</main>

          {showTop && (
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="fixed bottom-6 right-6 z-50 h-11 w-11 rounded-full bg-gradient-gold text-primary-foreground shadow-elegant flex items-center justify-center hover:scale-110 transition-transform animate-scale-in"
              aria-label="Scroll to top"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </SidebarProvider>
  );
}
