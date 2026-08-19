import { useEffect, useState } from "react";

type ThemeMode = "dark" | "light";

export type ThemeToggleProps = {
  inline?: boolean;
};

const storageKey = "chmarl-mawani-theme";

function preferredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(storageKey);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function ThemeToggle({ inline = false }: ThemeToggleProps) {
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
      className={inline ? "theme-toggle theme-toggle-inline" : "theme-toggle"}
      aria-label={`Switch to ${nextTheme} interface`}
      title={`Switch to ${nextTheme} interface`}
      onClick={() => setTheme(nextTheme)}>
      <span className="theme-toggle-track" aria-hidden="true"><i /></span>
      <strong>{theme === "dark" ? "Dark" : "Light"}</strong>
    </button>
  );
}
