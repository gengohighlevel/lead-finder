import { describe, it, expect } from 'vitest';
import { BACKGROUNDS, ACCENTS, DEFAULTS, MANAGED_VARS, normalizeAppearance, appearanceToCss, pickBackground, type Appearance } from '../lib/appearance';

const A = (o: Partial<Appearance> = {}): Appearance => ({ ...DEFAULTS, ...o });

describe('catalogue', () => {
  it('has the beach photo first, unique ids, and a name and picture for each', () => {
    expect(BACKGROUNDS[0].id).toBe('beach');
    expect(new Set(BACKGROUNDS.map(b => b.id)).size).toBe(BACKGROUNDS.length);
    expect(BACKGROUNDS.length).toBeGreaterThanOrEqual(14);
    for (const b of BACKGROUNDS) { expect(b.name, b.id).toBeTruthy(); expect(b.css, b.id).toMatch(/gradient|url\(/); }
  });
  it('gradients are light or dark, and every dark one says so', () => {
    const dark = BACKGROUNDS.filter(b => b.mode === 'dark').map(b => b.id);
    expect(dark).toEqual(expect.arrayContaining(['graphite', 'midnight', 'nebula', 'ember', 'forest']));
  });
  it('accents have a light and a dark shade and unique ids', () => {
    expect(ACCENTS[0].id).toBe('blue');
    expect(new Set(ACCENTS.map(a => a.id)).size).toBe(ACCENTS.length);
    for (const a of ACCENTS) { expect(a.light).toMatch(/^#[0-9a-f]{6}$/i); expect(a.dark).toMatch(/^#[0-9a-f]{6}$/i); }
  });
});

describe('normalizeAppearance', () => {
  it('turns anything unusable into the defaults', () => {
    for (const bad of [undefined, null, 5, 'x', [], {}]) expect(normalizeAppearance(bad)).toEqual(DEFAULTS);
  });
  it('keeps valid values and drops unknown ones', () => {
    const n = normalizeAppearance({ background: 'ocean', theme: 'dark', accent: 'violet', roundness: 'round', density: 'compact', shadow: 'strong', frosted: true, nonsense: 1 });
    expect(n).toMatchObject({ background: 'ocean', theme: 'dark', accent: 'violet', roundness: 'round', density: 'compact', shadow: 'strong', frosted: true });
    expect(n).not.toHaveProperty('nonsense');
    expect(normalizeAppearance({ background: 'nope', theme: 'purple', accent: '?', roundness: 'x', density: 'y', shadow: 'z', frosted: 'yes' })).toEqual(DEFAULTS);
  });
  it('clamps sliders, and null means automatic', () => {
    expect(normalizeAppearance({ dim: 999, blur: -4, cardOpacity: 5, clarity: 400 })).toMatchObject({ dim: 80, blur: 0, cardOpacity: 40, clarity: 100 });
    expect(normalizeAppearance({ dim: null, blur: null, cardOpacity: null, clarity: null })).toMatchObject({ dim: null, blur: null, cardOpacity: null, clarity: null });
    expect(normalizeAppearance({ dim: 'abc' }).dim).toBeNull();
    expect(normalizeAppearance({ dim: 12.7 }).dim).toBe(13);
  });
});

describe('appearanceToCss', () => {
  it('the defaults change nothing: the stylesheet already is the default look', () => {
    expect(appearanceToCss(DEFAULTS)).toEqual({ vars: {}, attrs: { frost: false } });
  });
  it('a gradient background sets the picture and no photo blur', () => {
    const { vars } = appearanceToCss(A({ background: 'aurora' }));
    expect(vars['--bg-image']).toMatch(/radial-gradient/);
    expect(vars['--bg-blur']).toBe('0px');
  });
  it('your own image is used when there is one, and the beach when there is not', () => {
    expect(appearanceToCss(A({ background: 'custom' }), 'data:image/jpeg;base64,AAAA').vars['--bg-image']).toBe('url("data:image/jpeg;base64,AAAA") center / cover no-repeat');
    expect(appearanceToCss(A({ background: 'custom' })).vars).toEqual({});
    expect(appearanceToCss(A({ background: 'custom' }), 'javascript:alert(1)').vars).toEqual({}); // only image data URLs
  });
  it('dim and blur', () => {
    expect(appearanceToCss(A({ dim: 30, blur: 8 })).vars).toMatchObject({ '--dim': '30%', '--bg-blur': '8px' });
    expect(appearanceToCss(A({ background: 'aurora', blur: 6 })).vars['--bg-blur']).toBe('6px'); // yours wins over the preset's
  });
  it('card opacity and glass clarity', () => {
    expect(appearanceToCss(A({ cardOpacity: 60 })).vars['--card-a']).toBe('0.6');
    const clear = appearanceToCss(A({ clarity: 100 })).vars, frosty = appearanceToCss(A({ clarity: 0 })).vars;
    expect(parseFloat(clear['--glass-a'])).toBeLessThan(parseFloat(frosty['--glass-a']));
    expect(parseFloat(clear['--bar-pct'])).toBeLessThan(parseFloat(frosty['--bar-pct']));
  });
  it('roundness, density and shadows', () => {
    expect(appearanceToCss(A({ roundness: 'round' })).vars).toMatchObject({ '--r-lg': '32px', '--r-xl': '36px' });
    expect(appearanceToCss(A({ roundness: 'sharp' })).vars).toMatchObject({ '--r-lg': '14px' });
    expect(appearanceToCss(A({ density: 'compact' })).vars).toMatchObject({ '--s-4': '12px', '--s-5': '16px' });
    expect(appearanceToCss(A({ density: 'spacious' })).vars).toMatchObject({ '--s-4': '20px', '--s-5': '26px' });
    expect(appearanceToCss(A({ shadow: 'none' })).vars['--shadow-k']).toBe('0');
    expect(appearanceToCss(A({ shadow: 'strong' })).vars['--shadow-k']).toBe('2.2');
  });
  it('accent colours set both shades; blue is the default and sets nothing', () => {
    expect(appearanceToCss(A({ accent: 'violet' })).vars).toMatchObject({ '--accent-l': ACCENTS.find(a => a.id === 'violet')!.light, '--accent-d': ACCENTS.find(a => a.id === 'violet')!.dark });
    expect(appearanceToCss(A({ accent: 'blue' })).vars).toEqual({});
  });
  it('theme and frosted cards become attributes', () => {
    expect(appearanceToCss(A({ theme: 'dark', frosted: true })).attrs).toEqual({ theme: 'dark', frost: true });
    expect(appearanceToCss(A({ theme: 'light' })).attrs.theme).toBe('light');
    expect(appearanceToCss(A({ theme: 'auto' })).attrs.theme).toBeUndefined();
  });
  it('every variable it can set is on the cleanup list, so changing a setting back removes it', () => {
    const everything = A({ background: 'aurora', dim: 20, blur: 3, cardOpacity: 50, clarity: 20, roundness: 'round', density: 'spacious', shadow: 'strong', accent: 'pink' });
    for (const k of Object.keys(appearanceToCss(everything).vars)) expect(MANAGED_VARS, k).toContain(k);
    for (const k of Object.keys(appearanceToCss(A({ background: 'custom' }), 'data:image/png;base64,AA').vars)) expect(MANAGED_VARS, k).toContain(k);
  });
});

describe('pictures from your own folders', () => {
  it('accepts a collection/file id and keeps it', () => {
    for (const id of ['file:ios/a1b2c3d4e5.jpg', 'file:my-set/pic_1.webp', 'file:macos/IMG-20.PNG']) expect(normalizeAppearance({ background: id }).background, id).toBe(id);
  });
  it('rejects anything that could point outside the folder or is not an image', () => {
    for (const id of ['file:', 'file:../etc/passwd', 'file:ios/../../x.jpg', 'file:a/b/c.jpg', 'file:ios/x.svg', 'file:ios/x.jpg?y', 'file:ios\\x.jpg', 'file:/ios/x.jpg', 'file:ios/.jpg']) expect(normalizeAppearance({ background: id }).background, id).toBe(DEFAULTS.background);
  });
  it('sets the picture from the local folder, sharp by default', () => {
    expect(appearanceToCss(A({ background: 'file:ios/a1b2c3d4e5.jpg' })).vars).toMatchObject({ '--bg-image': 'url("/backgrounds/ios/a1b2c3d4e5.jpg") center / cover no-repeat', '--bg-blur': '0px' });
    expect(appearanceToCss(A({ background: 'file:ios/a.jpg', blur: 9 })).vars['--bg-blur']).toBe('9px');
  });
  it('choosing one leaves the theme alone', () => {
    expect(pickBackground(A({ theme: 'dark' }), 'file:ios/a.jpg')).toEqual({ background: 'file:ios/a.jpg', theme: 'dark' });
  });
});

describe('pickBackground', () => {
  it('choosing a dark background also switches to dark, a light one to light; the beach leaves the theme alone', () => {
    expect(pickBackground(A({ theme: 'auto' }), 'midnight')).toMatchObject({ background: 'midnight', theme: 'dark' });
    expect(pickBackground(A({ theme: 'dark' }), 'aurora')).toMatchObject({ background: 'aurora', theme: 'light' });
    expect(pickBackground(A({ theme: 'dark' }), 'beach')).toMatchObject({ background: 'beach', theme: 'dark' });
    expect(pickBackground(A({ theme: 'dark' }), 'custom')).toMatchObject({ background: 'custom', theme: 'dark' });
  });
  it('changes the picture only, never the card settings', () => {
    expect(Object.keys(pickBackground(A(), 'ocean')).sort()).toEqual(['background', 'theme']);
  });
});
