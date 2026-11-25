import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCollections } from '../lib/localBackgrounds';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-bg-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const put = (rel: string, data = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), data); };

describe('listCollections', () => {
  it('an empty or missing folder has no collections', () => {
    expect(listCollections(dir)).toEqual([]);
    expect(listCollections(path.join(dir, 'nope'))).toEqual([]);
  });
  it('lists every image in each sub-folder, with a readable title', () => {
    put('ios/a1.jpg'); put('ios/b2.png'); put('ios/notes.txt'); put('macos/c3.webp'); put('my-photos/d4.JPEG');
    const c = listCollections(dir);
    expect(c.map(x => x.id)).toEqual(['ios', 'macos', 'my-photos']);
    expect(c.map(x => x.title)).toEqual(['iOS', 'macOS', 'My Photos']);
    expect(c[0].items.map(i => i.file)).toEqual(['a1.jpg', 'b2.png']);
    expect(c[2].items.map(i => i.file)).toEqual(['d4.JPEG']);
  });
  it('uses the preview when there is one, and the picture itself when there is not', () => {
    put('ios/a1.jpg'); put('ios/thumbs/a1.jpg'); put('ios/b2.jpg');
    const [c] = listCollections(dir);
    expect(c.items.find(i => i.file === 'a1.jpg')!.thumb).toBe('thumbs/a1.jpg');
    expect(c.items.find(i => i.file === 'b2.jpg')!.thumb).toBe('b2.jpg');
  });
  it('adds sizes from manifest.json and ignores manifest entries whose file is gone', () => {
    put('ios/a1.jpg'); put('ios/manifest.json', JSON.stringify([{ file: 'a1.jpg', w: 2000, h: 1000 }, { file: 'gone.jpg', w: 1, h: 1 }]));
    const [c] = listCollections(dir);
    expect(c.items).toEqual([{ file: 'a1.jpg', thumb: 'a1.jpg', w: 2000, h: 1000 }]);
  });
  it('survives a broken manifest', () => {
    put('ios/a1.jpg'); put('ios/manifest.json', '{ not json');
    expect(listCollections(dir)[0].items).toHaveLength(1);
  });
  it('skips folders and files with unsafe names, and empty folders', () => {
    put('Weird Name/a.jpg'); put('ok/bad name.jpg'); put('ok/..hidden.jpg'); put('ok/fine.jpg'); put('empty/readme.txt');
    const c = listCollections(dir);
    expect(c.map(x => x.id)).toEqual(['ok']);
    expect(c[0].items.map(i => i.file)).toEqual(['fine.jpg']);
  });
});
