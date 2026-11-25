#!/usr/bin/env node
// Create the one login for the hosted Lead Finder. Run it on YOUR computer, never on the server:
//   node scripts/make-login.mjs                 asks for your email and a password, writes the settings into .env.server
//   node scripts/make-login.mjs --generate      makes a strong password for you and shows it once
// It makes: a password hash (scrypt), an authenticator secret (scan the QR code with your phone), 8 one-time recovery codes,
// and a session secret. Nothing is sent anywhere. The password and recovery codes are shown ONCE: store them in a password manager.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { hashPassword, verifyPassword, randomBase32, generateRecoveryCodes, hashRecoveryCode, totpCode, verifyTotp } = await import('../lib/auth.ts');

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const envFile = path.resolve(opt('out') ?? path.join(here, '..', '.env.server'));

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) { rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(s); else if (s === '\r\n' || s === '\n') process.stdout.write('\n'); }; }
    rl.question(question, a => { rl.close(); resolve(a); });
  });
}
const readStdin = () => new Promise(r => { let d = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => (d += c)); process.stdin.on('end', () => r(d.replace(/\r?\n$/, ''))); });

const strong = () => { const w = []; for (let i = 0; i < 6; i++) w.push(crypto.randomBytes(4).toString('base64url').replace(/[-_]/g, 'x').slice(0, 5)); return w.join('-'); };

let email = opt('email');
if (!email) email = (await ask('Your login email: ')).trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('That does not look like an email address.'); process.exit(1); }

let password, generated = false;
if (flag('generate')) { password = strong(); generated = true; }
else if (flag('password-stdin')) password = await readStdin();
else {
  password = await ask('Choose a password (at least 12 characters): ', { hidden: true });
  const again = await ask('Type it again: ', { hidden: true });
  if (password !== again) { console.error('The two passwords are different. Nothing was changed.'); process.exit(1); }
}
if (password.length < 12) { console.error('The password must be at least 12 characters. Nothing was changed.'); process.exit(1); }

// keep any existing login unless told to replace it
let text = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
if (/^ADMIN_PASSWORD_HASH=.+/m.test(text) && !flag('force')) { console.error(`${envFile} already has a login. Run again with --force to replace it (this signs everyone out and invalidates the old authenticator).`); process.exit(1); }

const passwordHash = await hashPassword(password);
const totpSecret = randomBase32(32);
const sessionSecret = crypto.randomBytes(48).toString('base64url');
const recoveryCodes = generateRecoveryCodes(8);
const recoveryHashes = recoveryCodes.map(hashRecoveryCode);

// prove it all works before saving anything
if (!(await verifyPassword(password, passwordHash))) { console.error('Self-check failed (password).'); process.exit(1); }
if (verifyTotp(totpSecret, totpCode(totpSecret, Date.now()), Date.now()) === undefined) { console.error('Self-check failed (authenticator).'); process.exit(1); }

const settings = {
  AUTH_MODE: 'password', ADMIN_EMAIL: email.toLowerCase(), ADMIN_PASSWORD_HASH: passwordHash, ADMIN_TOTP_SECRET: totpSecret,
  SESSION_SECRET: sessionSecret, RECOVERY_CODE_HASHES: recoveryHashes.join(','),
};
for (const [k, v] of Object.entries(settings)) {
  const line = `${k}=${v}`;
  text = new RegExp(`^${k}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${k}=.*$`, 'm'), () => line) : `${text.replace(/\n*$/, '\n')}${line}\n`;
}
fs.mkdirSync(path.dirname(envFile), { recursive: true });
fs.writeFileSync(envFile, text, { mode: 0o600 });
fs.chmodSync(envFile, 0o600);

const issuer = 'Lead Finder';
const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${totpSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

console.log(`\nSaved the login settings to ${envFile} (readable only by you).\n`);
if (generated) console.log(`Your password (shown once):  ${password}\n`);
console.log('1) AUTHENTICATOR: scan this with Google Authenticator, Authy, 1Password or similar:\n');
if (!flag('no-qr')) {
  try { const qr = (await import('qrcode-terminal')).default; qr.generate(uri, { small: true }); } catch { console.log('(QR code library not installed: run npm install, or type the key by hand)'); }
}
console.log(`\n   Or type this key in by hand:  ${totpSecret.match(/.{1,4}/g).join(' ')}\n`);
console.log('2) RECOVERY CODES (each works once, if you lose your phone). Store them in a password manager NOW; they are not shown again:\n');
for (const c of recoveryCodes) console.log(`     ${c}`);
console.log('\n3) Next: copy .env.server to your server (see deploy/README.md). To sign in you need: this email, your password, and a 6-digit code from the app.\n');
