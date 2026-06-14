import { AlertTriangle, BarChart3, LayoutDashboard, ShieldAlert, Users2, Terminal } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import type { ComponentType } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  exact?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { href: "/", icon: LayoutDashboard, label: "Overview", exact: true },
      { href: "/alerts", icon: AlertTriangle, label: "Alerts" },
    ],
  },
  {
    label: "Investigation",
    items: [{ href: "/users", icon: Users2, label: "Users" }],
  },
  {
    label: "Analytics",
    items: [
      { href: "/evaluation", icon: BarChart3, label: "Evaluation" },
      { href: "/sandbox", icon: Terminal, label: "Sandbox" },
    ],
  },
];

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = useLocation().pathname;
  const { state } = useSidebar();

  function isActive(item: NavItem) {
    return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
  }

  return (
    <Sidebar collapsible="icon" variant="sidebar" {...props}>
      <SidebarHeader className="flex h-16 shrink-0 flex-row items-center gap-2 border-b border-border px-2 py-0">
        <NavLink
          to="/"
          className={cn(
            "flex min-h-0 min-w-0 flex-1 items-center gap-2",
            state === "collapsed" && "justify-center",
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center bg-primary text-primary-foreground">
            <ShieldAlert className="h-4 w-4" />
          </div>
          {state !== "collapsed" && (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold">Sentinel</span>
              <span className="truncate text-xs text-sidebar-foreground/65">
                Insider Threat Detection
              </span>
            </div>
          )}
        </NavLink>
      </SidebarHeader>

      <SidebarContent className="pt-3">
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(item)}
                        tooltip={item.label}
                      >
                        <NavLink to={item.href} end={item.exact}>
                          <Icon />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator className="mx-0 my-2" />
        <div className={cn("px-2 pb-2", state === "collapsed" && "flex justify-center px-0")}>
          <ThemeToggle />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
