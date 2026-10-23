import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { authClient, meQuery } from "@/lib/auth";

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await authClient.signOut();
    queryClient.clear();
    await navigate({ to: "/sign-in" });
  };
}

export function UserMenu() {
  const me = useQuery(meQuery);
  const signOut = useSignOut();
  if (!me.data) return null;
  const { user } = me.data;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton size="lg" aria-label={`Account: ${user.name}`} />}
      >
        <Avatar className="size-8 rounded-lg">
          {user.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback className="rounded-lg">{initials(user.name)}</AvatarFallback>
        </Avatar>
        <span className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{user.name}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </span>
        <ChevronsUpDown className="ml-auto size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--anchor-width) min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/settings" />}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
