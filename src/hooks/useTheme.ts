"use client";

import { useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "elkiosk-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

/**
 * Theme hook. Toggles between light and dark mode.
 * Persists preference in localStorage and applies the
 * `light` / `dark` class on <html>.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  // Read from localStorage on mount (client only)
  useEffect(() => {
    const initial = getInitialTheme();
    setThemeState(initial);
    applyThemeToDocument(initial);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
      applyThemeToDocument(next);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}

function applyThemeToDocument(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.setAttribute("data-theme", theme);
}
