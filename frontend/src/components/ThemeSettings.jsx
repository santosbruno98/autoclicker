import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
} from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'myplatform.theme';
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

const options = [
  {
    value: 'dark',
    label: 'Dark',
    description: 'Use the dark palette.',
    icon: Moon,
  },
  {
    value: 'light',
    label: 'Light',
    description: 'Use the light palette.',
    icon: Sun,
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow this device’s appearance setting.',
    icon: Monitor,
  },
];

const ThemeContext = createContext(null);

function readPreference() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return options.some(({ value }) => value === saved) ? saved : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia(SYSTEM_THEME_QUERY).matches
  );

  const theme = preference === 'system'
    ? (systemDark ? 'dark' : 'light')
    : preference;

  useLayoutEffect(() => {
    const query = window.matchMedia(SYSTEM_THEME_QUERY);

    function syncSystemTheme() {
      setSystemDark(query.matches);
    }

    query.addEventListener('change', syncSystemTheme);
    syncSystemTheme();

    return () => query.removeEventListener('change', syncSystemTheme);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function chooseTheme(value) {
    setPreference(value);

    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Theme changes still apply for the current page when storage is blocked.
    }
  }

  return (
    <ThemeContext.Provider value={{ preference, theme, chooseTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }

  return context;
}

function AppearanceSettings() {
  const { preference, theme, chooseTheme } = useTheme();

  return (
    <section
      aria-labelledby="appearance-heading"
      className="terminal-card space-y-5 p-5 sm:p-6"
    >
      <div>
        <h2 id="appearance-heading" className="text-lg font-semibold text-white">
          Appearance
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Choose how MyPlatform looks in this browser.
        </p>
      </div>

      <fieldset>
        <legend className="mb-3 text-sm font-medium text-slate-300">
          Platform theme
        </legend>

        <div className="grid gap-3 sm:grid-cols-3">
          {options.map(({ value, label, description, icon: Icon }) => (
            <label
              key={value}
              className={`theme-option flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${
                preference === value ? 'theme-option-selected' : ''
              }`}
            >
              <input
                type="radio"
                name="platform-theme"
                value={value}
                checked={preference === value}
                onChange={() => chooseTheme(value)}
                className="mt-1 shrink-0"
              />

              <span>
                <span className="flex items-center gap-2 font-semibold text-white">
                  <Icon size={16} aria-hidden="true" />
                  {label}
                </span>
                <span className="mt-1 block text-sm text-slate-400">
                  {description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-sm text-slate-400" aria-live="polite">
        Active theme: {theme === 'dark' ? 'Dark' : 'Light'}
      </p>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <AppearanceSettings />
    </div>
  );
}