import fs from 'node:fs';
import path from 'node:path';

/**
 * Wallpaper collections you keep on this computer: each sub-folder of public/backgrounds is a collection of images.
 * Optional extras per folder: a `thumbs/` folder of small previews, and a `manifest.json` of [{ file, w, h }] with the sizes.
 * The folder is excluded from git, so your own images are never committed or shared.
 */
export type LocalItem = { file: string; thumb: string; w?: number; h?: number };
export type Collection = { id: string; title: string; items: LocalItem[] };

const SAFE_DIR = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:jpe?g|png|webp)$/i;
const TITLES: Record<string, string> = { ios: 'iOS', macos: 'macOS', ipados: 'iPadOS', watchos: 'watchOS', tvos: 'tvOS' };

const title = (id: string) => TITLES[id] ?? id.split('-').map(w => TITLES[w] ?? (/^\d+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');

export function listCollections(root: string): Collection[] {
  let dirs: fs.Dirent[];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const out: Collection[] = [];
  for (const d of dirs.filter(d => d.isDirectory() && SAFE_DIR.test(d.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(root, d.name);
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter(f => f.isFile() && SAFE_FILE.test(f.name)).map(f => f.name).sort();
    if (!files.length) continue;
    let sizes = new Map<string, { w?: number; h?: number }>();
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { file?: string; w?: number; h?: number }[];
      if (Array.isArray(rows)) sizes = new Map(rows.filter(r => typeof r?.file === 'string').map(r => [r.file!, { w: r.w, h: r.h }]));
    } catch { /* no manifest, or a broken one: sizes are optional */ }
    const hasThumbs = (f: string) => fs.existsSync(path.join(dir, 'thumbs', f));
    out.push({
      id: d.name, title: title(d.name),
      items: files.map(file => ({ file, thumb: hasThumbs(file) ? `thumbs/${file}` : file, ...(sizes.get(file) ?? {}) })),
    });
  }
  return out;
}
