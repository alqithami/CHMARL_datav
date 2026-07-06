import { useEffect, useState } from "react";

type ThemeMode = "dark" | "light";

const storageKey = "chmarl-mawani-theme";

function preferredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(storageKey);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(preferredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(storageKey, theme);
  }, [theme]);

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${nextTheme} interface`}
      title={`Switch to ${nextTheme} interface`}
      onClick={() => setTheme(nextTheme)}>
      <span aria-hidden="true">{theme === "dark" ? "☾" : "☼"}</span>
      <strong>{theme === "dark" ? "Dark" : "Light"}</strong>
    </button>
  );
}
