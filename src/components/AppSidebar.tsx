import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, BookOpen, Layers, Upload, BarChart3, GraduationCap, Bot, CalendarCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { topicIdentity } from "@/lib/topicIdentity";
import { cn } from "@/lib/utils";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, useSidebar,
} from "@/components/ui/sidebar";

const mainNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Library", url: "/library", icon: Upload },
  { title: "Assessments", url: "/assessments", icon: BookOpen },
  { title: "Practice", url: "/practice", icon: Layers },
  { title: "Today's Review", url: "/review", icon: CalendarCheck },
  { title: "AI Tutor", url: "/tutor", icon: Bot },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
];

interface TopicMasteryItem {
  topic: string;
  fullTopic?: string;
  value: number;
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const isActive = (path: string) => pathname === path;
  const [topics, setTopics] = useState<{ title: string; count: number }[]>([]);

  useEffect(() => {
    apiFetch("/analytics/dashboard")
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data) => {
        setTopics(((data.topicMastery || []) as TopicMasteryItem[]).slice(0, 5).map((topic) => ({
          title: topic.fullTopic || topic.topic,
          count: topic.value,
        })));
      })
      .catch(() => setTopics([]));
  }, []);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      {/* Fixed to the same shared height as the main topbar, so the two bottom
          borders form one continuous line. It used to size itself from its
          contents — 76px expanded, 68px collapsed — which is why the divider sat
          lower than the topbar's and shifted when the rail collapsed. Collapsing
          now changes the header's contents, never its height. */}
      <SidebarHeader
        className={cn(
          "h-header shrink-0 justify-center border-b border-sidebar-border",
          collapsed ? "p-0" : "px-2",
        )}
      >
        <div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg bg-gradient-brand shadow-glow",
              collapsed ? "h-11 w-11" : "h-9 w-9 rounded-md",
            )}
          >
            <GraduationCap className={cn("text-primary-foreground", collapsed ? "h-6 w-6" : "h-5 w-5")} />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-serif text-lg leading-none text-foreground">Athenaeum</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-1">Intelligent Learning</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="scrollbar-thin">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} className="group">
                      <item.icon className="h-4 w-4 transition-colors group-hover:text-accent" />
                      {!collapsed && <span className="text-sm">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
              Topics
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {topics.map((t) => {
                  const { Icon, accent, chip } = topicIdentity(t.title);
                  return (
                    <SidebarMenuItem key={t.title}>
                      {/* Fixed icon / flexible title / fixed count. `min-w-0` on the
                          middle column is what lets the title ellipsis instead of
                          pushing the percentage onto a second line. */}
                      <SidebarMenuButton
                        className="group gap-2.5"
                        title={t.title}
                        aria-label={`${t.title}, ${t.count}% mastery`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${chip} ${accent}`}
                        >
                          <Icon className="h-3 w-3" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                          {t.count}%
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
