// Apply the saved theme before first paint to avoid a flash. A blocking external
// script (not inline) so the CSP can stay script-src 'self'.
try {
  const t = localStorage.getItem("talvra-theme");
  const dark =
    t === "dark" || ((!t || t === "system") && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
} catch {}
