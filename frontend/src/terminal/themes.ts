// Five hand-picked terminal palettes. The TUI uses its own theme set so
// the operator can keep, say, "Sakura Bloom" for the GUI and "Phosphor
// Green" for the terminal — without one bleeding into the other.

export interface TuiPalette {
  id: string;
  i18nKey: string;
  bg: string;
  surface: string;
  fg: string;
  fgDim: string;
  prompt: string;
  accent: string;
  err: string;
  ok: string;
  warn: string;
  selBg: string;
}

export const DEFAULT_TUI_THEME_ID = 'nord-term';

export const TUI_THEMES: TuiPalette[] = [
  {
    id: 'phosphor',
    i18nKey: 'phosphor',
    bg: '#020602',
    surface: '#0a140a',
    fg: '#33ff66',
    fgDim: '#1f8a37',
    prompt: '#5cff85',
    accent: '#a8ffa8',
    err: '#ff6b6b',
    ok: '#33ff66',
    warn: '#ffd866',
    selBg: '#0f2a14',
  },
  {
    id: 'amber',
    i18nKey: 'amber',
    bg: '#0e0700',
    surface: '#1a0e02',
    fg: '#ffb000',
    fgDim: '#a0700a',
    prompt: '#ffd87a',
    accent: '#ffe0a0',
    err: '#ff6b3d',
    ok: '#ffb000',
    warn: '#ffe070',
    selBg: '#1f1404',
  },
  {
    id: 'cathode',
    i18nKey: 'cathode',
    bg: '#001020',
    surface: '#001830',
    fg: '#7ec8ff',
    fgDim: '#3a78b5',
    prompt: '#a3d8ff',
    accent: '#cce6ff',
    err: '#ff7e8a',
    ok: '#7ad6a8',
    warn: '#ffd070',
    selBg: '#002648',
  },
  {
    id: 'solarized-term',
    i18nKey: 'solarizedTerm',
    bg: '#002b36',
    surface: '#073642',
    fg: '#93a1a1',
    fgDim: '#586e75',
    prompt: '#b58900',
    accent: '#268bd2',
    err: '#dc322f',
    ok: '#859900',
    warn: '#cb4b16',
    selBg: '#0d4654',
  },
  {
    id: 'nord-term',
    i18nKey: 'nordTerm',
    bg: '#1d2129',
    surface: '#262a33',
    fg: '#d8dee9',
    fgDim: '#7c8492',
    prompt: '#88c0d0',
    accent: '#81a1c1',
    err: '#bf616a',
    ok: '#a3be8c',
    warn: '#ebcb8b',
    selBg: '#2e3440',
  },
];

export function getTuiTheme(id: string): TuiPalette {
  return (
    TUI_THEMES.find((p) => p.id === id) ||
    TUI_THEMES.find((p) => p.id === DEFAULT_TUI_THEME_ID) ||
    TUI_THEMES[0]
  );
}

export function applyTuiTheme(p: TuiPalette): void {
  const root = document.documentElement;
  root.style.setProperty('--tui-bg', p.bg);
  root.style.setProperty('--tui-surface', p.surface);
  root.style.setProperty('--tui-fg', p.fg);
  root.style.setProperty('--tui-fg-dim', p.fgDim);
  root.style.setProperty('--tui-prompt', p.prompt);
  root.style.setProperty('--tui-accent', p.accent);
  root.style.setProperty('--tui-err', p.err);
  root.style.setProperty('--tui-ok', p.ok);
  root.style.setProperty('--tui-warn', p.warn);
  root.style.setProperty('--tui-sel-bg', p.selBg);
}
