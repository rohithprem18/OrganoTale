// Theme handling for OrganoTale (issue #2): a light/dark switch that is
// remembered in localStorage and falls back to the OS prefers-color-scheme.
// The inline script in index.html applies the same logic before first paint,
// so there is no flash of the wrong theme.
export const THEME_KEY = 'organotale-theme';
export const THEMES = ['light', 'dark'];

/** The explicitly chosen theme from storage, or null when unset/invalid. */
export function getStoredTheme(storage = globalThis.localStorage) {
  const value = storage?.getItem?.(THEME_KEY);
  return THEMES.includes(value) ? value : null;
}

/** Whether the operating system currently prefers a dark color scheme. */
export function prefersDark(media = globalThis.matchMedia) {
  return Boolean(media?.('(prefers-color-scheme: dark)')?.matches);
}

/** The effective theme: a stored choice always wins over the system preference. */
export function resolveTheme(stored, systemDark) {
  if (THEMES.includes(stored)) return stored;
  return systemDark ? 'dark' : 'light';
}

/** The theme the document is currently showing (set pre-paint by index.html). */
export function currentTheme(doc = globalThis.document) {
  const attr = doc?.documentElement?.dataset?.theme;
  return THEMES.includes(attr) ? attr : 'light';
}

/** Persists a new choice and flips the data-theme attribute + theme-color meta. */
export function applyTheme(theme, doc = globalThis.document, storage = globalThis.localStorage) {
  if (!THEMES.includes(theme)) return theme;
  try { storage?.setItem?.(THEME_KEY, theme); } catch { /* storage unavailable (private mode) */ }
  const root = doc?.documentElement;
  if (root) root.dataset.theme = theme;
  const meta = doc?.querySelector?.('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#171511' : '#f4b942');
  return theme;
}

export function nextTheme(theme) {
  return theme === 'dark' ? 'light' : 'dark';
}
