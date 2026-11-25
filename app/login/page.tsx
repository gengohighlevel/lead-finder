'use client';
import { useState, type FormEvent } from 'react';

/** Sign in (hosted app with its own login). The account is made on the owner's computer with scripts/make-login.mjs: there is no sign-up. */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recovery ? { email, password, recovery: code } : { email, password, code }) });
      const text = await res.text();
      let j: { ok?: boolean; error?: string; recoveryUsed?: boolean } = {};
      try { j = JSON.parse(text); } catch { /* not JSON */ }
      if (res.ok && j.ok) {
        if (j.recoveryUsed) { setNotice('That recovery code is now used up. Set up your authenticator again soon.'); setTimeout(() => { window.location.href = '/'; }, 2500); }
        else window.location.href = '/';
        return;
      }
      setError(j.error ?? 'Could not sign in. Try again.');
      setCode('');
    } catch { setError('Could not reach the server. Try again.'); }
    finally { setBusy(false); }
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form onSubmit={submit} className="panel material" style={{ width: 'min(420px, 100%)', display: 'grid', gap: 12 }} aria-labelledby="login-h">
        <div className="panel-head"><h1 id="login-h" style={{ fontSize: 22, margin: 0 }}>Lead Finder</h1><span className="hint">sign in</span></div>
        <label style={{ display: 'grid', gap: 4 }}>Email
          <input className="input" type="email" name="email" autoComplete="username" required autoFocus value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>Password
          <input className="input" type="password" name="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>{recovery ? 'Recovery code' : 'Authenticator code'}
          <input className="input" name="code" inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" required value={code} maxLength={recovery ? 14 : 7}
            placeholder={recovery ? 'ABCDE-FGHIJ' : '6 digits'} onChange={e => setCode(e.target.value)} />
        </label>
        {error && <div className="callout material" data-tone="bad" role="alert"><span>{error}</span></div>}
        {notice && <div className="callout material" data-tone="info" role="status"><span>{notice}</span></div>}
        <button type="submit" className="btn" disabled={busy || !email || !password || !code}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="link-btn" onClick={() => { setRecovery(r => !r); setCode(''); setError(null); }}>
          {recovery ? 'Use my authenticator app instead' : 'I lost my phone: use a recovery code'}
        </button>
      </form>
    </main>
  );
}
