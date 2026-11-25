import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * The only file that talks to DuckDB. Overture Maps publishes its places as open Parquet files on a public bucket;
 * DuckDB reads just the rows it needs over the network, so nothing is downloaded or installed beyond the npm package.
 */
const FALLBACK_RELEASE = '2026-11-18.0';
const RELEASE_TTL_MS = 12 * 3_600_000;
const RELEASE_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/;

let conn: Promise<DuckDBConnection> | undefined;
function connect(): Promise<DuckDBConnection> {
  conn ??= (async () => {
    const { DuckDBInstance } = await import('@duckdb/node-api');
    const c = await (await DuckDBInstance.create(':memory:')).connect();
    await c.run("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';");
    return c;
  })().catch(e => { conn = undefined; throw e; }); // a failed start is retried on the next search
  return conn;
}

/** Rows as plain JSON objects (big integers become strings). */
export async function queryRows(sql: string): Promise<Record<string, unknown>[]> {
  const c = await connect();
  const r = await c.runAndReadAll(sql);
  return r.getRowObjectsJson() as Record<string, unknown>[];
}

let release: { id: string; at: number } | undefined;
/** The newest Overture release. Old ones are deleted from the bucket, so a fixed id would stop working. */
export async function latestRelease(): Promise<string> {
  if (release && Date.now() - release.at < RELEASE_TTL_MS) return release.id;
  try {
    const res = await fetch('https://stac.overturemaps.org/catalog.json', { signal: AbortSignal.timeout(8_000) });
    const id = res.ok ? ((await res.json()) as { latest?: string }).latest : undefined;
    if (id && RELEASE_RE.test(id)) { release = { id, at: Date.now() }; return id; }
  } catch { /* use the last known release */ }
  return release?.id ?? FALLBACK_RELEASE;
}
