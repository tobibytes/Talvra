import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("talvra-theme", next ? "dark" : "light");
    } catch {
      // Private mode: the theme still applies for this visit.
    }
    setDark(next);
  };
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <Tooltip content={label}>
      <Button variant="ghost" size="icon" onClick={toggle} aria-label={label}>
        {dark ? <Sun /> : <Moon />}
      </Button>
    </Tooltip>
  );
}
