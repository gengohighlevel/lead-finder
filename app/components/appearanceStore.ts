import { appearanceToCss, DEFAULTS, MANAGED_VARS, normalizeAppearance, type Appearance } from '@/lib/appearance';

/** Browser side of Settings: apply to the page, remember on this computer, and shrink uploaded images. */
const K = { settings: 'lf-appearance', vars: 'lf-vars', attrs: 'lf-attrs', custom: 'lf-bg', image: 'lf-bg-image' };

export function loadAppearance(): { appearance: Appearance; image?: string } {
  try {
    const appearance = normalizeAppearance(JSON.parse(localStorage.getItem(K.settings) ?? 'null'));
    return { appearance, image: localStorage.getItem(K.image) ?? undefined };
  } catch { return { appearance: { ...DEFAULTS } }; }
}

/** Put the choices on the page right now. */
export function applyAppearance(a: Appearance, image?: string): void {
  const root = document.documentElement;
  const { vars, attrs } = appearanceToCss(a, image);
  for (const k of MANAGED_VARS) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  if (attrs.theme) root.dataset.theme = attrs.theme; else delete root.dataset.theme;
  if (attrs.frost) root.dataset.frost = 'on'; else delete root.dataset.frost;
}

/**
 * Remember the choices. The small script in the page head reads these keys before the first paint, so the page never flashes
 * the default look. Returns false if the browser has no room left (a big image is the usual cause).
 */
export function saveAppearance(a: Appearance, image?: string): boolean {
  try {
    const { vars, attrs } = appearanceToCss(a, image);
    const custom = a.background === 'custom' && !!vars['--bg-image'];
    const { ['--bg-image']: _picture, ...rest } = vars; // a custom picture is big, so it is stored once, under its own key
    void _picture;
    localStorage.setItem(K.vars, JSON.stringify(custom ? rest : vars));
    localStorage.setItem(K.attrs, JSON.stringify(attrs));
    if (custom) { localStorage.setItem(K.custom, 'custom'); if (image) localStorage.setItem(K.image, image); } else localStorage.removeItem(K.custom);
    localStorage.setItem(K.settings, JSON.stringify(a));
    return true;
  } catch { return false; }
}

export function forgetImage(): void {
  try { localStorage.removeItem(K.image); localStorage.removeItem(K.custom); } catch { /* ignore */ }
}

/** An uploaded picture, shrunk so it fits in browser storage and stays quick to draw. */
export async function readImageFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That is not an image file.');
  if (file.size > 30 * 1024 * 1024) throw new Error('That image is over 30 MB. Pick a smaller one.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This browser cannot open that image. JPG, PNG and WebP work.'));
      i.src = url;
    });
    for (const [edge, quality] of [[2200, 0.85], [1600, 0.78], [1200, 0.7]] as const) {
      const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length < 3_000_000) return data;
    }
    throw new Error('That image is too detailed to store. Try a smaller one.');
  } finally { URL.revokeObjectURL(url); }
}
