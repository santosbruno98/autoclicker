import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
} from 'react';
import { Monitor, Moon, Palette, Sun } from 'lucide-react';

import './theme-palette.css';

const THEME_KEY = 'myplatform.theme';
const PALETTE_KEY = 'myplatform.customPalette';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const themes = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'graphite', label: 'Graphite', icon: Moon },
  { value: 'custom', label: 'Custom', icon: Palette },
];

const colorGroups = [
  {
    label: 'Surfaces',
    fields: [
      ['--app-bg', 'Workspace background', '#29323E'],
      ['--app-sidebar', 'Sidebar background', '#282A2F'],
      ['--app-header', 'Header background', '#272C2E'],
      ['--app-card', 'Cards and panels', '#1B1B1B'],
      ['--app-input', 'Inputs and controls', '#282A2F'],
      ['--app-raised', 'Hover backgrounds', '#35414F'],
      ['--app-border', 'Borders and dividers', '#5E6C82'],
      ['--app-scrollbar', 'Scrollbar', '#7184A1'],
    ],
  },
  {
    label: 'Text and actions',
    fields: [
      ['--app-strong', 'Headings', '#FFFFFF'],
      ['--app-text', 'Main text', '#E7F1FF'],
      ['--app-muted', 'Secondary text', '#BCDEFF'],
      ['--app-accent', 'Links and icons', '#26EBFF'],
      ['--palette-selection', 'Selected navigation and controls', '#184851'],
      ['--palette-button', 'Primary buttons', '#26EBFF'],
      ['--palette-button-text', 'Primary button text', '#102128'],
      ['--palette-secondary', 'Secondary buttons', '#303843'],
    ],
  },
  {
    label: 'Status and charts',
    fields: [
      ['--palette-success', 'Success and gains', '#19E6A7'],
      ['--palette-warning', 'Warnings', '#FFD166'],
      ['--palette-danger', 'Errors and losses', '#FF8299'],
      ['--palette-info', 'Information', '#B8A9FF'],
      ['--palette-chart-primary', 'Portfolio chart line', '#26EBFF'],
      ['--palette-chart-benchmark', 'Benchmark chart line', '#FFD166'],
    ],
  },
];

const graphite = Object.fromEntries(
  colorGroups.flatMap(({ fields }) =>
    fields.map(([name, , color]) => [name, color])
  )
);

const ThemeContext = createContext(null);

function readPreference() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return themes.some(({ value }) => value === saved) ? saved : 'dark';
  } catch {
    return 'dark';
  }
}

function readPalette() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PALETTE_KEY) || '{}');

    return Object.fromEntries(
      Object.entries(graphite).map(([name, fallback]) => {
        const color = saved?.[name];
        const valid = typeof color === 'string' && HEX_COLOR.test(color);
        return [name, valid ? color.toUpperCase() : fallback];
      })
    );
  } catch {
    return { ...graphite };
  }
}

function writePreference(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Changes still apply for this session if browser storage is unavailable.
  }
}

function paletteAppearance(background) {
  const [red, green, blue] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(background.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });

  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.179 ? 'light' : 'dark';
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readPreference);
  const [palette, setPalette] = useState(readPalette);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia(SYSTEM_QUERY).matches
  );

  const activePalette = preference === 'graphite'
    ? graphite
    : preference === 'custom' ? palette : null;

  let theme = preference;
  if (activePalette) {
    theme = paletteAppearance(activePalette['--app-bg']);
  } else if (preference === 'system') {
    theme = systemDark ? 'dark' : 'light';
  }

  useLayoutEffect(() => {
    const query = window.matchMedia(SYSTEM_QUERY);
    const sync = () => setSystemDark(query.matches);

    query.addEventListener('change', sync);
    sync();

    return () => query.removeEventListener('change', sync);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;

    if (!activePalette) return undefined;

    root.dataset.palette = preference;

    for (const [name, color] of Object.entries(activePalette)) {
      root.style.setProperty(name, color);
    }

    return () => {
      delete root.dataset.palette;
      for (const name of Object.keys(activePalette)) {
        root.style.removeProperty(name);
      }
    };
  }, [activePalette, preference, theme]);

  useLayoutEffect(() => {
    writePreference(PALETTE_KEY, JSON.stringify(palette));
  }, [palette]);

  function chooseTheme(value) {
    setPreference(value);
    writePreference(THEME_KEY, value);
  }

  function updateColor(name, value) {
    if (!Object.hasOwn(graphite, name) || !HEX_COLOR.test(value)) return;

    setPalette((current) => ({
      ...current,
      [name]: value.toUpperCase(),
    }));
    chooseTheme('custom');
  }

  function resetPalette() {
    setPalette({ ...graphite });
    chooseTheme('custom');
  }

  return (
    <ThemeContext.Provider value={{
      preference,
      theme,
      palette,
      chooseTheme,
      updateColor,
      resetPalette,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}

function ColorControl({ name, label, value, onChange }) {
  const [draft, setDraft] = useState(null);
  const id = `color-${name.slice(2)}`;

  function commit() {
    if (draft === null) return;

    const input = draft.trim();
    const color = input.startsWith('#') ? input : `#${input}`;

    if (HEX_COLOR.test(color)) {
      onChange(name, color);
    }

    setDraft(null);
  }

  return (
    <div className="palette-color-control">
      <label htmlFor={id} className="text-sm font-medium text-white">
        {label}
      </label>

      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(event) => {
            setDraft(null);
            onChange(name, event.target.value);
          }}
        />
        <input
          type="text"
          aria-label={`${label} hex value`}
          className="terminal-input font-mono"
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          value={draft ?? value}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const {
    preference,
    theme,
    palette,
    chooseTheme,
    updateColor,
    resetPalette,
  } = useTheme();

  return (
    <section
      aria-labelledby="appearance-heading"
      className="terminal-card space-y-5 p-5 sm:p-6"
    >
      <h2 id="appearance-heading" className="text-lg font-semibold text-white">
        Appearance
      </h2>

      <fieldset>
        <legend className="mb-3 text-sm font-medium text-slate-300">
          Platform theme
        </legend>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {themes.map(({ value, label, icon: Icon }) => (
            <label
              key={value}
              className={`theme-option flex cursor-pointer items-center gap-2 rounded-xl border p-3 ${
                preference === value ? 'theme-option-selected' : ''
              }`}
            >
              <input
                type="radio"
                name="platform-theme"
                value={value}
                checked={preference === value}
                onChange={() => chooseTheme(value)}
              />
              <Icon size={16} className="shrink-0" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {preference === 'system' && (
        <p className="text-sm text-slate-400" aria-live="polite">
          Using {theme === 'dark' ? 'Dark' : 'Light'} from your device.
        </p>
      )}

      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-400">
            Edit your saved custom palette below. Changing a color activates Custom.
            Press Enter to apply a hex value.
          </p>
          <button
            type="button"
            className="terminal-button-secondary"
            onClick={resetPalette}
          >
            Reset to Graphite
          </button>
        </div>

        {colorGroups.map(({ label, fields }) => (
          <fieldset key={label} className="rounded-xl border border-white/10 p-4">
            <legend className="px-2 text-sm font-semibold text-white">
              {label}
            </legend>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map(([name, fieldLabel]) => (
                <ColorControl
                  key={name}
                  name={name}
                  label={fieldLabel}
                  value={palette[name]}
                  onChange={updateColor}
                />
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-5xl space-y-6">
      <AppearanceSettings />
    </div>
  );
}