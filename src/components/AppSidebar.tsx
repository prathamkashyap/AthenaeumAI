import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, BookOpen, Layers, Upload, BarChart3, ScrollText, GraduationCap } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, useSidebar,
} from "@/components/ui/sidebar";

const mainNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Library", url: "/library", icon: Upload },
  { title: "Assessments", url: "/assessments", icon: BookOpen },
  { title: "Practice", url: "/practice", icon: Layers },
  { title: "Question Bank", url: "/question-bank", icon: ScrollText },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
];

const topics = [
  { title: "Data Structures", count: 42 },
  { title: "Operating Systems", count: 28 },
  { title: "DBMS", count: 35 },
  { title: "Computer Networks", count: 19 },
  { title: "Machine Learning", count: 24 },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const isActive = (path: string) => pathname === path;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-gold shadow-glow">
            <GraduationCap className="h-5 w-5 text-primary-foreground" />
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
                {topics.map((t) => (
                  <SidebarMenuItem key={t.title}>
                    <SidebarMenuButton className="group justify-between">
                      <div className="flex items-center gap-2">
                        <ScrollText className="h-3.5 w-3.5 text-muted-foreground group-hover:text-accent" />
                        <span className="text-sm">{t.title}</span>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">{t.count}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
