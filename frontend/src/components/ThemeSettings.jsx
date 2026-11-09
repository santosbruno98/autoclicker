// frontend/src/components/ThemeSettings.jsx
import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
} from 'react';

const STORAGE_KEY = 'myplatform.theme';
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

const OPTIONS = [
  { value: 'dark', label: 'Dark', description: 'Use the dark palette.' },
  { value: 'light', label: 'Light', description: 'Use the light palette.' },
  { value: 'system', label: 'System', description: 'Follow this device’s appearance setting.' },
];

const ThemeContext = createContext(null);

function readPreference() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return OPTIONS.some(({ value }) => value === saved) ? saved : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia(SYSTEM_THEME_QUERY).matches,
  );

  const theme = preference === 'system'
    ? (systemDark ? 'dark' : 'light')
    : preference;

  useLayoutEffect(() => {
    const query = window.matchMedia(SYSTEM_THEME_QUERY);
    const sync = () => setSystemDark(query.matches);

    query.addEventListener('change', sync);
    sync();

    return () => query.removeEventListener('change', sync);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function chooseTheme(value) {
    setPreference(value);

    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // The active page can still switch themes when storage is unavailable.
    }
  }

  return (
    <ThemeContext.Provider value={{ preference, theme, chooseTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ThemeSettings() {
  const { preference, theme, chooseTheme } = useTheme();

  return (
    <section className="terminal-card space-y-4 p-5">
      <h2 className="text-lg font-semibold">Appearance</h2>
      <p>Choose how MyPlatform looks in this browser.</p>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Platform theme</legend>

        {OPTIONS.map(({ value, label, description }) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
          >
            <input
              type="radio"
              name="platform-theme"
              value={value}
              checked={preference === value}
              onChange={() => chooseTheme(value)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">{label}</span>
              <span className="block text-sm">{description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <p className="text-sm" aria-live="polite">
        Active theme: {theme === 'dark' ? 'Dark' : 'Light'}
      </p>
    </section>
  );
}