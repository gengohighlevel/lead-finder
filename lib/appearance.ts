/**
 * Appearance settings: background, theme, accent colour and how the cards look. Pure logic only; reading and writing the page
 * and browser storage is in app/components/appearanceStore.ts. Everything here is "turn these choices into CSS variables".
 *
 * The stylesheet already is the default look, so default choices emit nothing. Each setting emits only what it changes, and
 * MANAGED_VARS lists every variable this file can set so a change back can remove it.
 */
export type ThemeChoice = 'auto' | 'light' | 'dark';
export type Roundness = 'sharp' | 'default' | 'round';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type ShadowChoice = 'none' | 'soft' | 'strong';

export type Appearance = {
  background: string;            // a BACKGROUNDS id, 'custom' (your own upload), or 'file:<collection>/<image>' (a picture in public/backgrounds)
  dim: number | null;            // 0..80, how much the background is darkened or lightened; null = automatic
  blur: number | null;           // 0..24 px; null = automatic
  theme: ThemeChoice;
  accent: string;                // an ACCENTS id
  cardOpacity: number | null;    // 40..100, how solid the cards are; null = automatic
  clarity: number | null;        // 0..100, how clear the sidebar and bars are; null = automatic
  frosted: boolean;              // blur behind the cards (prettier, heavier to scroll)
  roundness: Roundness;
  density: Density;
  shadow: ShadowChoice;
};

export const DEFAULTS: Appearance = {
  background: 'beach', dim: null, blur: null, theme: 'auto', accent: 'blue', cardOpacity: null, clarity: null,
  frosted: false, roundness: 'default', density: 'comfortable', shadow: 'soft',
};

export type Background = { id: string; name: string; css: string; mode?: 'light' | 'dark'; blur?: number };

/** A soft, iOS-style colour mesh: blobs of colour over a base. Original artwork, drawn in CSS. */
const mesh = (base: string, blobs: [number, number, string][]) =>
  [...blobs.map(([x, y, c]) => `radial-gradient(62% 62% at ${x}% ${y}%, ${c} 0%, transparent 70%)`), `linear-gradient(${base}, ${base})`].join(', ');

export const BACKGROUNDS: Background[] = [
  { id: 'beach', name: 'Beach', css: "url('/background.jpg') center / cover no-repeat" },
  { id: 'aurora', name: 'Aurora', mode: 'light', blur: 0, css: mesh('#e8edf8', [[15, 10, '#8ec5ff'], [90, 15, '#c9a7ff'], [80, 95, '#ffc2d9'], [10, 90, '#9ff0e0']]) },
  { id: 'sunrise', name: 'Sunrise', mode: 'light', blur: 0, css: mesh('#fdeee2', [[10, 10, '#ffd29a'], [90, 10, '#ff9fb8'], [85, 90, '#c7a6ff'], [15, 95, '#ffe3a3']]) },
  { id: 'ocean', name: 'Ocean', mode: 'light', blur: 0, css: mesh('#e4f4f8', [[10, 15, '#7fd6e8'], [85, 10, '#8db8ff'], [90, 90, '#bff0e6'], [10, 90, '#a3e0ff']]) },
  { id: 'lavender', name: 'Lavender', mode: 'light', blur: 0, css: mesh('#efe9fa', [[10, 10, '#d6c2ff'], [90, 20, '#ffc8e8'], [80, 95, '#c0d4ff'], [10, 85, '#e7d6ff']]) },
  { id: 'peach', name: 'Peach', mode: 'light', blur: 0, css: mesh('#fff0ea', [[10, 10, '#ffc6a8'], [90, 15, '#ffdca8'], [85, 90, '#ffb8c8'], [15, 90, '#ffd5c2']]) },
  { id: 'mint', name: 'Mint', mode: 'light', blur: 0, css: mesh('#e8f7f0', [[10, 15, '#a8ecd0'], [90, 10, '#d4f2a8'], [85, 90, '#9fe0ec'], [10, 90, '#d0f5e0']]) },
  { id: 'rose', name: 'Rose', mode: 'light', blur: 0, css: mesh('#fbe9f0', [[10, 10, '#ffb8d0'], [90, 15, '#e0b8ff'], [85, 90, '#ffd0c0'], [15, 90, '#ffc0e0']]) },
  { id: 'sand', name: 'Sand', mode: 'light', blur: 0, css: mesh('#f6efe4', [[10, 10, '#f0d9b5'], [90, 10, '#e9c8a0'], [85, 90, '#f2e2c8'], [15, 90, '#d8e6d0']]) },
  { id: 'graphite', name: 'Graphite', mode: 'dark', blur: 0, css: mesh('#14161b', [[10, 10, '#3a4150'], [90, 15, '#2a3140'], [85, 90, '#454b5a'], [15, 95, '#242932']]) },
  { id: 'midnight', name: 'Midnight', mode: 'dark', blur: 0, css: mesh('#0b1020', [[10, 10, '#1f3b8f'], [90, 15, '#5a2d9c'], [85, 95, '#143a6b'], [10, 90, '#2c1f6b']]) },
  { id: 'nebula', name: 'Nebula', mode: 'dark', blur: 0, css: mesh('#120a1f', [[15, 10, '#6b2fd0'], [90, 20, '#d02f8f'], [80, 95, '#2f4fd0'], [10, 90, '#8a2fd0']]) },
  { id: 'ember', name: 'Ember', mode: 'dark', blur: 0, css: mesh('#1a0d0b', [[10, 10, '#c2410c'], [90, 15, '#b91c1c'], [85, 95, '#7c2d12'], [10, 90, '#a16207']]) },
  { id: 'forest', name: 'Forest', mode: 'dark', blur: 0, css: mesh('#0c1712', [[10, 10, '#166534'], [90, 15, '#0f766e'], [85, 95, '#14532d'], [10, 90, '#365314']]) },
];

export type Accent = { id: string; name: string; light: string; dark: string };
export const ACCENTS: Accent[] = [
  { id: 'blue', name: 'Blue', light: '#1f63c4', dark: '#6ea8f2' },
  { id: 'violet', name: 'Violet', light: '#6246d6', dark: '#a79df0' },
  { id: 'pink', name: 'Pink', light: '#c2336f', dark: '#f08ab0' },
  { id: 'red', name: 'Red', light: '#c0332b', dark: '#f08a82' },
  { id: 'orange', name: 'Orange', light: '#b5500c', dark: '#f2a060' },
  { id: 'green', name: 'Green', light: '#1a7f37', dark: '#5fd38a' },
  { id: 'teal', name: 'Teal', light: '#0f766e', dark: '#5fd3c6' },
  { id: 'graphite', name: 'Graphite', light: '#3a3f4b', dark: '#c3c9d6' },
];

const ROUND: Record<Roundness, Record<string, string>> = {
  sharp: { '--r-xl': '20px', '--r-lg': '14px', '--r-md': '10px', '--r-sm': '8px' },
  default: {},
  round: { '--r-xl': '36px', '--r-lg': '32px', '--r-md': '20px', '--r-sm': '14px' },
};
const DENSITY: Record<Density, Record<string, string>> = {
  compact: { '--s-3': '10px', '--s-4': '12px', '--s-5': '16px', '--s-6': '20px' },
  comfortable: {},
  spacious: { '--s-3': '14px', '--s-4': '20px', '--s-5': '26px', '--s-6': '30px' },
};
const SHADOW_K: Record<ShadowChoice, string | undefined> = { none: '0', soft: undefined, strong: '2.2' };

/** Every CSS variable appearanceToCss can set. */
export const MANAGED_VARS = [
  '--bg-image', '--bg-blur', '--dim', '--card-a', '--glass-a', '--bar-pct', '--shadow-k', '--accent-l', '--accent-d',
  ...Object.keys(ROUND.round), ...Object.keys(DENSITY.compact),
];

/** A picture in public/backgrounds/<collection>/. Strict on purpose: no slashes beyond one, no dots at the start, images only. */
const LOCAL_ID = /^file:([a-z0-9][a-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*\.(?:jpe?g|png|webp))$/i;
export function parseLocalId(id: unknown): { collection: string; file: string } | undefined {
  const m = typeof id === 'string' ? id.match(LOCAL_ID) : null;
  return m && m[1] === m[1].toLowerCase() ? { collection: m[1], file: m[2] } : undefined; // collection folders are lower case
}

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options as readonly unknown[]).includes(v) ? (v as T) : fallback;
const slider = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null;

/** Whatever was saved (possibly old, edited or broken) -> a valid Appearance. */
export function normalizeAppearance(raw: unknown): Appearance {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  return {
    background: parseLocalId(r.background) ? (r.background as string) : oneOf(r.background, [...BACKGROUNDS.map(b => b.id), 'custom'], DEFAULTS.background),
    dim: slider(r.dim, 0, 80),
    blur: slider(r.blur, 0, 24),
    theme: oneOf(r.theme, ['auto', 'light', 'dark'] as const, DEFAULTS.theme),
    accent: oneOf(r.accent, ACCENTS.map(a => a.id), DEFAULTS.accent),
    cardOpacity: slider(r.cardOpacity, 40, 100),
    clarity: slider(r.clarity, 0, 100),
    frosted: r.frosted === true,
    roundness: oneOf(r.roundness, ['sharp', 'default', 'round'] as const, DEFAULTS.roundness),
    density: oneOf(r.density, ['compact', 'comfortable', 'spacious'] as const, DEFAULTS.density),
    shadow: oneOf(r.shadow, ['none', 'soft', 'strong'] as const, DEFAULTS.shadow),
  };
}

const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/;
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

export function appearanceToCss(a: Appearance, customImage?: string): { vars: Record<string, string>; attrs: { theme?: 'light' | 'dark'; frost: boolean } } {
  const vars: Record<string, string> = {};
  const preset = BACKGROUNDS.find(b => b.id === a.background);
  if (a.background === 'custom' && customImage && IMAGE_DATA_URL.test(customImage)) {
    vars['--bg-image'] = `url("${customImage}") center / cover no-repeat`;
  } else if (parseLocalId(a.background)) {
    const { collection, file } = parseLocalId(a.background)!;
    vars['--bg-image'] = `url("/backgrounds/${collection}/${file}") center / cover no-repeat`;
    vars['--bg-blur'] = '0px'; // real wallpapers are sharp; the soft blur is for the small beach photo
  } else if (preset && preset.id !== 'beach') {
    vars['--bg-image'] = preset.css;
    if (preset.blur !== undefined) vars['--bg-blur'] = `${preset.blur}px`;
  }
  if (a.blur !== null) vars['--bg-blur'] = `${a.blur}px`;
  if (a.dim !== null) vars['--dim'] = `${a.dim}%`;
  if (a.cardOpacity !== null) vars['--card-a'] = String(round(a.cardOpacity / 100, 2));
  if (a.clarity !== null) {
    vars['--glass-a'] = String(round(0.6 - 0.46 * (a.clarity / 100), 2)); // 0.60 frosty .. 0.14 clear
    vars['--bar-pct'] = `${Math.round(80 - 55 * (a.clarity / 100))}%`;     // 80% .. 25%
  }
  const k = SHADOW_K[a.shadow];
  if (k !== undefined) vars['--shadow-k'] = k;
  const accent = ACCENTS.find(x => x.id === a.accent);
  if (accent && accent.id !== 'blue') { vars['--accent-l'] = accent.light; vars['--accent-d'] = accent.dark; }
  Object.assign(vars, ROUND[a.roundness], DENSITY[a.density]);
  return { vars, attrs: { ...(a.theme !== 'auto' ? { theme: a.theme } : {}), frost: a.frosted } };
}

/** Choosing a background: a dark one switches to dark mode and a light one to light, so text stays readable. */
export function pickBackground(a: Appearance, id: string): Pick<Appearance, 'background' | 'theme'> {
  const mode = BACKGROUNDS.find(b => b.id === id)?.mode;
  return { background: id, theme: mode ?? a.theme };
}
