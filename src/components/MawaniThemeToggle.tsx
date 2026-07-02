import { useEffect, useState } from "react";

type ThemeMode = "dark" | "light";

function initialTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("mawani-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function MawaniThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("mawani-theme", theme);
  }, [theme]);

  return (
    <button
      type="button"
      className="mawani-theme-toggle"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
    >
      <span aria-hidden="true">{theme === "dark" ? "☾" : "☼"}</span>
      <strong>{theme === "dark" ? "Dark" : "Light"}</strong>
    </button>
  );
}
