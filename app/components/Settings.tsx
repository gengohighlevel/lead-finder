'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ACCENTS, BACKGROUNDS, DEFAULTS, normalizeAppearance, pickBackground, type Appearance } from '@/lib/appearance';
import { applyAppearance, forgetImage, loadAppearance, readImageFile, saveAppearance } from './appearanceStore';
import type { Collection, LocalItem } from '@/lib/localBackgrounds';
import { Icon } from './Icons';
import { OutreachRules } from './OutreachRules';
import { Backups } from './Backups';

type Opt<T extends string> = [T, string];

type Shape = 'all' | 'wide' | 'tall' | 'square';
const shapeOf = (i: LocalItem): Exclude<Shape, 'all'> | undefined => (i.w && i.h ? (i.w / i.h >= 1.3 ? 'wide' : i.w / i.h <= 0.8 ? 'tall' : 'square') : undefined);
const PAGE = 48;

/** Wallpaper collections kept in public/backgrounds: pick one of hundreds of pictures. */
function Collections({ collections, current, onPick }: { collections: Collection[]; current: string; onPick: (id: string) => void }) {
  const [id, setId] = useState(() => collections.find(c => current.startsWith(`file:${c.id}/`))?.id ?? collections[0].id);
  const [shape, setShape] = useState<Shape>('all');
  const [limit, setLimit] = useState(PAGE);
  const c = collections.find(x => x.id === id) ?? collections[0];
  const known = c.items.some(i => shapeOf(i));
  const counts: Record<Shape, number> = { all: c.items.length, wide: 0, tall: 0, square: 0 };
  for (const i of c.items) { const s = shapeOf(i); if (s) counts[s]++; }
  const shown = c.items.filter(i => shape === 'all' || shapeOf(i) === shape);

  return (
    <section className="panel material" aria-labelledby="coll-h">
      <div className="panel-head">
        <h2 id="coll-h">Your collections</h2><span className="hint">pictures kept on this computer · {collections.reduce((n, x) => n + x.items.length, 0)} in all</span>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Collection">
          {collections.map(x => <button key={x.id} type="button" aria-pressed={x.id === c.id} onClick={() => { setId(x.id); setShape('all'); setLimit(PAGE); }}>{x.title} <span className="muted num">{x.items.length}</span></button>)}
        </div>
        {known && (
          <div className="seg" role="group" aria-label="Shape">
            {(['all', 'wide', 'tall', 'square'] as Shape[]).filter(s => s === 'all' || counts[s] > 0).map(s => (
              <button key={s} type="button" aria-pressed={shape === s} onClick={() => { setShape(s); setLimit(PAGE); }}>{s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)} <span className="muted num">{counts[s]}</span></button>
            ))}
          </div>
        )}
      </div>
      {known && shape === 'tall' && <p className="setting-hint" style={{ marginBottom: 'var(--s-3)' }}>Tall phone wallpapers are cropped on a wide screen. Wide ones fit best.</p>}
      <div className="bg-grid" role="group" aria-label={`${c.title} pictures`}>
        {shown.slice(0, limit).map((i, n) => {
          const bid = `file:${c.id}/${i.file}`;
          return (
            <button key={i.file} type="button" className="bg-tile" aria-pressed={current === bid} aria-label={`${c.title} picture ${n + 1}`} onClick={() => onPick(bid)}>
              <span className="bg-thumb">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`/backgrounds/${c.id}/${i.thumb}`} alt="" loading="lazy" decoding="async" /></span>
            </button>
          );
        })}
      </div>
      {shown.length > limit && (
        <div className="more"><button type="button" className="btn" onClick={() => setLimit(n => n + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more <span className="muted num">({shown.length - limit} left)</span></button></div>
      )}
      {!shown.length && <p className="muted">Nothing in this shape.</p>}
    </section>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div><div className="setting-title">{title}</div>{hint && <div className="setting-hint">{hint}</div>}</div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Opt<T>[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, t]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  );
}

/** A slider whose value can be "Auto": left alone, the stylesheet picks for light or dark mode. */
function Slider({ label, value, fallback, min, max, unit, onChange }: { label: string; value: number | null; fallback: number; min: number; max: number; unit: string; onChange: (v: number | null) => void }) {
  return (
    <div className="slider">
      <input type="range" aria-label={label} min={min} max={max} value={value ?? fallback} onChange={e => onChange(Number(e.target.value))} />
      <span className="num slider-value">{value === null ? 'Auto' : `${value}${unit}`}</span>
      {value !== null && <button type="button" className="btn btn-ghost" onClick={() => onChange(null)} aria-label={`Set ${label} back to automatic`}>Auto</button>}
    </div>
  );
}

export function Settings() {
  const [a, setA] = useState<Appearance>({ ...DEFAULTS });
  const [image, setImage] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const file = useRef<HTMLInputElement>(null);
  // The latest values, updated at once. Two changes in the same instant must build on each other, not on the last render.
  const now = useRef<{ a: Appearance; image?: string }>({ a: { ...DEFAULTS } });

  useEffect(() => { const l = loadAppearance(); now.current = { a: l.appearance, image: l.image }; setA(l.appearance); setImage(l.image); }, []);
  useEffect(() => { fetch('/api/backgrounds').then(r => r.json()).then(j => setCollections(j.collections ?? [])).catch(() => {}); }, []);

  function update(patch: Partial<Appearance>, img: string | undefined | null = null) {
    const picture = img === null ? now.current.image : img; // null = keep the current picture, undefined = no picture
    const next = normalizeAppearance({ ...now.current.a, ...patch });
    now.current = { a: next, image: picture };
    setA(next); setImage(picture);
    applyAppearance(next, picture);
    setProblem(saveAppearance(next, picture) ? null : 'Your browser has no room left to remember this. The change works until you close the page.');
  }

  async function upload(f: File | undefined) {
    if (!f) return;
    setBusy(true); setProblem(null);
    try {
      const data = await readImageFile(f);
      update({ background: 'custom' }, data);
    } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not use that image.'); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  }
  function removeImage() {
    forgetImage();
    update({ background: now.current.a.background === 'custom' ? 'beach' : now.current.a.background }, undefined);
  }
  function reset() {
    forgetImage();
    now.current = { a: { ...DEFAULTS } };
    setImage(undefined); setA({ ...DEFAULTS }); applyAppearance(DEFAULTS); saveAppearance(DEFAULTS); setProblem(null);
  }

  return (
    <>
      <OutreachRules />
      <Backups />

      <section className="panel material" aria-labelledby="bg-h">
        <div className="panel-head">
          <h2 id="bg-h">Background</h2><span className="hint">what shows through the glass</span><span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={reset}><Icon name="reset" size={15} />Reset everything</button>
        </div>
        <div className="bg-grid" role="group" aria-label="Background">
          {BACKGROUNDS.map(b => (
            <button key={b.id} type="button" className="bg-tile" aria-pressed={a.background === b.id} onClick={() => update(pickBackground(now.current.a, b.id))}>
              <span className="bg-thumb" style={{ background: b.css }} />
              <span className="bg-name">{b.name}{b.mode === 'dark' ? <span className="muted"> · dark</span> : null}</span>
            </button>
          ))}
          {image && (
            <button type="button" className="bg-tile" aria-pressed={a.background === 'custom'} onClick={() => update(pickBackground(now.current.a, 'custom'))}>
              <span className="bg-thumb" style={{ background: `url("${image}") center / cover no-repeat` }} />
              <span className="bg-name">Your image</span>
            </button>
          )}
          <label className="bg-tile bg-upload" data-busy={busy}>
            <input ref={file} type="file" accept="image/*" className="sr-only" onChange={e => upload(e.target.files?.[0])} />
            <span className="bg-thumb"><Icon name={busy ? 'loader' : 'upload'} size={22} className={busy ? 'spin' : undefined} /></span>
            <span className="bg-name">{busy ? 'Reading…' : 'Upload your own'}</span>
          </label>
        </div>
        {problem && <div className="callout material" data-tone="warn" role="alert" style={{ marginTop: 'var(--s-4)' }}><Icon name="alert" />{problem}</div>}

        <div className="settings-rows">
          <Row title="Dim" hint="Darkens or lightens the picture so text stays easy to read.">
            <Slider label="Dim" value={a.dim} fallback={20} min={0} max={80} unit="%" onChange={v => update({ dim: v })} />
          </Row>
          <Row title="Blur" hint="Softens the picture. Gradients do not need it.">
            <Slider label="Blur" value={a.blur} fallback={5} min={0} max={24} unit=" px" onChange={v => update({ blur: v })} />
          </Row>
        </div>
        {image && <button type="button" className="btn btn-ghost" onClick={removeImage}>Remove your image</button>}
      </section>

      {collections.length > 0 && <Collections collections={collections} current={a.background} onPick={id => update(pickBackground(now.current.a, id))} />}

      <section className="panel material" aria-labelledby="look-h">
        <div className="panel-head"><h2 id="look-h">Look and feel</h2><span className="hint">cards, bars and colour</span></div>
        <div className="settings-rows">
          <Row title="Theme" hint="Auto follows your computer. A dark background switches to dark for you.">
            <Choice label="Theme" value={a.theme} options={[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} onChange={v => update({ theme: v })} />
          </Row>
          <Row title="Accent colour" hint="Buttons, links, charts and highlights.">
            <div className="swatches" role="group" aria-label="Accent colour">
              {ACCENTS.map(c => (
                <button key={c.id} type="button" className="swatch" aria-pressed={a.accent === c.id} aria-label={c.name} title={c.name} style={{ background: c.light }} onClick={() => update({ accent: c.id })} />
              ))}
            </div>
          </Row>
          <Row title="Card opacity" hint="Lower lets more of the background through the cards.">
            <Slider label="Card opacity" value={a.cardOpacity} fallback={82} min={40} max={100} unit="%" onChange={v => update({ cardOpacity: v })} />
          </Row>
          <Row title="Glass clarity" hint="The sidebar and the bars. Clearer shows more of the background.">
            <Slider label="Glass clarity" value={a.clarity} fallback={50} min={0} max={100} unit="%" onChange={v => update({ clarity: v })} />
          </Row>
          <Row title="Frosted cards" hint="Blurs the background behind each card. Prettier, but scrolling is a little heavier.">
            <label className="switch">
              <input type="checkbox" role="switch" checked={a.frosted} onChange={e => update({ frosted: e.target.checked })} />
              <span className="switch-track" aria-hidden="true" />
              <span>{a.frosted ? 'On' : 'Off'}</span>
            </label>
          </Row>
          <Row title="Corners">
            <Choice label="Corners" value={a.roundness} options={[['sharp', 'Sharp'], ['default', 'Default'], ['round', 'Round']]} onChange={v => update({ roundness: v })} />
          </Row>
          <Row title="Spacing" hint="How much room there is inside and between cards.">
            <Choice label="Spacing" value={a.density} options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]} onChange={v => update({ density: v })} />
          </Row>
          <Row title="Shadows">
            <Choice label="Shadows" value={a.shadow} options={[['none', 'None'], ['soft', 'Soft'], ['strong', 'Strong']]} onChange={v => update({ shadow: v })} />
          </Row>
        </div>
      </section>

      <details className="fold material">
        <summary><Icon name="chevron" size={16} className="chev" />About these backgrounds<span className="hint">where they come from and where they are kept</span></summary>
        <div className="fold-body">
          <ul>
            <li>The gradients are original, drawn for this app in the soft style of iOS. Apple’s own wallpapers are Apple’s artwork and are not available to bundle.</li>
            <li>To use one picture, choose <b>Upload your own</b>. It is shrunk and kept in this browser only; nothing is uploaded anywhere.</li>
            <li>For many pictures, put them in a folder inside <code>public/backgrounds/</code> (for example <code>public/backgrounds/my-photos/</code>). Each folder becomes a collection here. The folder is kept out of git, so your pictures stay on this computer.</li>
            <li>Settings are remembered per browser on this computer. Another browser starts with the defaults.</li>
          </ul>
        </div>
      </details>
    </>
  );
}
