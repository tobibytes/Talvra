import { Link, useRouterState } from "@tanstack/react-router";
import { GraduationCap, Search } from "lucide-react";
import type * as React from "react";
import { ApiStatus } from "@/components/api-status";
import { CommandPaletteProvider, useCommandPalette } from "@/components/command-palette";
import { ThemeMenu } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { isActivePath, mobileTabs, type NavItem, primaryNav, secondaryNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <CommandPaletteProvider>
      <SidebarProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset>
          <TopBar />
          {/* SidebarInset is the <main> landmark; this is the skip-link target. */}
          <div
            id="main"
            tabIndex={-1}
            className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-24 outline-none md:px-8 md:pb-10"
          >
            {children}
          </div>
        </SidebarInset>
        <MobileTabBar />
      </SidebarProvider>
    </CommandPaletteProvider>
  );
}

function usePathname() {
  return useRouterState({ select: (s) => s.location.pathname });
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <GraduationCap className="size-4" />
      </span>
      <span className="group-data-[collapsible=icon]:hidden">Talvra</span>
    </Link>
  );
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = isActivePath(pathname, item.to);
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  isActive={active}
                  tooltip={item.label}
                  render={<Link to={item.to} aria-current={active ? "page" : undefined} />}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function AppSidebar() {
  return (
    <Sidebar collapsible="icon" aria-label="Main navigation">
      <SidebarHeader className="px-3 py-3">
        <Brand />
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Study" items={primaryNav} />
        <NavGroup label="You" items={secondaryNav} />
      </SidebarContent>
      <SidebarFooter className="px-3 pb-3 group-data-[collapsible=icon]:hidden">
        <ApiStatus />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function TopBar() {
  const palette = useCommandPalette();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
      <SidebarTrigger className="-ml-1 hidden md:inline-flex" aria-label="Toggle sidebar" />
      <div className="md:hidden">
        <Brand />
      </div>
      <Button
        variant="outline"
        className="ml-auto hidden w-64 justify-start gap-2 text-muted-foreground md:inline-flex"
        onClick={() => palette.setOpen(true)}
      >
        <Search />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto md:hidden"
        aria-label="Open command palette"
        onClick={() => palette.setOpen(true)}
      >
        <Search />
      </Button>
      <ThemeMenu />
    </header>
  );
}

function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {mobileTabs.map((item) => {
          const active = isActivePath(pathname, item.to);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:bg-muted",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
