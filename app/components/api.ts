/** Reads a JSON answer. An empty or non-JSON body (the server crashed or restarted) becomes a message that names the route. */
export async function readJson(res: Response, url: string): Promise<any> {
  const text = await res.text();
  if (!text.trim()) throw new Error(`The server sent no data (status ${res.status}) from ${url}. If you just changed code or restarted the app, reload the page and try again.`);
  try { return JSON.parse(text); }
  catch { throw new Error(`The server sent something that is not JSON (status ${res.status}) from ${url}.`); }
}

export async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await readJson(res, url);
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j;
}
export async function get(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  const j = await readJson(res, url);
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j;
}
