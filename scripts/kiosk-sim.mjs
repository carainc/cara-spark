#!/usr/bin/env node
/**
 * kiosk-sim — the no-hardware kiosk client (T16 / CAR-2395). Demo-able on a laptop, no Pi.
 *
 *   "the same failsafe agent in a $90 box with one button."
 *
 * It is a THIN client, exactly like the real Pi: it holds a DEVICE TOKEN and pushes a turn to the
 * server-side /api/kiosk/session endpoint, which bridges into the SAME agent loop + deterministic
 * engine. No triage logic lives here. Push-to-"talk" is spacebar/Enter on the laptop (type a
 * symptom instead of speaking); the bilingual escalation is printed "out loud" (console).
 *
 * Two modes:
 *   • live (default): mint a device token (same HMAC scheme as the server, via VOICE_CONFIG_HMAC_SECRET)
 *     and POST to a running server. Exercises the real loop end-to-end.
 *         VOICE_CONFIG_HMAC_SECRET=… node scripts/kiosk-sim.mjs --url http://localhost:3000 --agent demo
 *   • --offline: no server needed. Mints + self-verifies a device token (proves the auth path) and
 *     speaks the bilingual disclaimer, so the box is demo-able even with nothing running.
 *         node scripts/kiosk-sim.mjs --offline
 *
 * Anonymous by design: it sends an opaque, ephemeral sessionRef — never a name/DOB/account.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import readline from 'node:readline';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const OFFLINE = has('--offline');
const URL_BASE = (val('--url', process.env.KIOSK_URL || 'http://localhost:3000')).replace(/\/$/, '');
const AGENT_ID = val('--agent', process.env.KIOSK_AGENT_ID || 'demo-agent');
let LANG = val('--lang', 'en'); // en | es (greeting is always bilingual)

// ---------------------------------------------------------------------------
// Device token — SAME scheme as lib/kiosk/device-token.ts (ksk-v1.<dev>.<agent>.<sig>).
// Kept byte-compatible so a token this client mints verifies on the server unchanged.
// ---------------------------------------------------------------------------
const KIOSK_TOKEN_PREFIX = 'ksk-v1';
const SECRET = process.env.VOICE_CONFIG_HMAC_SECRET;

function mintDeviceToken(agentId, deviceId, secret) {
  if (!secret) throw new Error('VOICE_CONFIG_HMAC_SECRET is not set — cannot mint a device token.');
  const sig = createHmac('sha256', secret)
    .update(`${KIOSK_TOKEN_PREFIX}:${agentId}:${deviceId}`, 'utf8')
    .digest('base64url');
  const dev = Buffer.from(deviceId, 'utf8').toString('base64url');
  const agent = Buffer.from(agentId, 'utf8').toString('base64url');
  return `${KIOSK_TOKEN_PREFIX}.${dev}.${agent}.${sig}`;
}

function verifyDeviceToken(token, agentId, secret) {
  const [prefix, devB64, agentB64, sig] = String(token).split('.');
  if (prefix !== KIOSK_TOKEN_PREFIX || !devB64 || !agentB64 || !sig) return false;
  const deviceId = Buffer.from(devB64, 'base64url').toString('utf8');
  const tokenAgent = Buffer.from(agentB64, 'base64url').toString('utf8');
  if (tokenAgent !== agentId) return false;
  const expected = createHmac('sha256', secret)
    .update(`${KIOSK_TOKEN_PREFIX}:${agentId}:${deviceId}`, 'utf8')
    .digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const newSessionRef = () => `kss_${randomBytes(12).toString('base64url')}`;

// ---------------------------------------------------------------------------
// "Speaker" — print the spoken line out loud (with a tiny visual cue per LED state).
// ---------------------------------------------------------------------------
const LED = { idle: '🔵', listening: '🟢', thinking: '🟡', speaking: '🔊', escalate: '🔴' };
const speak = (state, text) => console.log(`${LED[state] || '•'}  ${text}`);

// Bilingual spoken disclaimer — mirrors lib/i18n kiosk.disclaimer (the screenless box has no footer).
const DISCLAIMER = {
  en: "Hi, I'm here to help you figure out what to do. This is not emergency care — if this is an emergency I'll help you call 9 1 1. Press the button and tell me what's going on.",
  es: 'Hola, estoy aquí para ayudarle a decidir qué hacer. Esto no es atención de emergencia — si es una emergencia le ayudaré a llamar al 9 1 1. Presione el botón y dígame qué le pasa.',
};

// ---------------------------------------------------------------------------
// One push-to-talk turn against the live server.
// ---------------------------------------------------------------------------
async function pushToTalk(utterance, token) {
  const sessionRef = newSessionRef();
  speak('thinking', LANG === 'es' ? 'Pensando…' : 'Thinking…');
  let res;
  try {
    res = await fetch(`${URL_BASE}/api/kiosk/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ agentId: AGENT_ID, lang: LANG, utterance, sessionRef }),
    });
  } catch (e) {
    // Fail-safe, never silent (build guide §7): a dead box still tells the person what to do.
    speak('escalate', DISCLAIMER[LANG]);
    console.error(`   (could not reach ${URL_BASE}: ${e.message})`);
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) speak('escalate', 'Device not authorized — check the token / agent id.');
    else speak('escalate', data.spoken || DISCLAIMER[LANG]);
    console.error(`   (HTTP ${res.status} ${JSON.stringify(data)})`);
    return;
  }
  // The engine decided. Speak the policy-authored line; play the chime + red LED on escalation.
  speak(data.isEscalation ? 'escalate' : 'speaking', data.spoken);
  if (data.isEscalation) console.log('   *** chime *** staff alert — this is an emergency escalation.');
  console.log(`   [engine action: ${data.action} · trace ${data.trace?.traceId ?? '?'}]`);
}

// ---------------------------------------------------------------------------
// Offline demo — no server: prove the device-token path + speak the disclaimer.
// ---------------------------------------------------------------------------
function offlineDemo() {
  console.log('— kiosk-sim (offline demo, no server) —\n');
  const secret = SECRET || randomBytes(32).toString('base64url'); // demo-only ephemeral secret
  const deviceId = `dev_${randomBytes(12).toString('base64url')}`;
  const token = mintDeviceToken(AGENT_ID, deviceId, secret);
  console.log(`device id   : ${deviceId}`);
  console.log(`device token: ${token.slice(0, 24)}…`);
  console.log(`verify(self): ${verifyDeviceToken(token, AGENT_ID, secret) ? 'OK ✓' : 'FAIL ✗'}`);
  console.log(`verify(forged): ${verifyDeviceToken(token + 'x', AGENT_ID, secret) ? 'OK ✗' : 'rejected ✓'}`);
  console.log('\nspoken disclaimer (bilingual, played on wake):');
  speak('idle', DISCLAIMER.en);
  speak('idle', DISCLAIMER.es);
  console.log('\nTo run the real loop end-to-end, start the app (pnpm dev) then:');
  console.log('  VOICE_CONFIG_HMAC_SECRET=… node scripts/kiosk-sim.mjs --agent <agentId>\n');
}

// ---------------------------------------------------------------------------
// Main — push-to-talk REPL (Enter = "press the button").
// ---------------------------------------------------------------------------
async function main() {
  if (OFFLINE) return offlineDemo();

  let token;
  try {
    token = mintDeviceToken(AGENT_ID, `dev_${randomBytes(12).toString('base64url')}`, SECRET);
  } catch (e) {
    console.error(e.message);
    console.error('Tip: run the offline demo with `node scripts/kiosk-sim.mjs --offline`.');
    process.exit(1);
  }

  console.log('— kiosk-sim — one button, no phone, no account. (Ctrl+C to quit)');
  console.log(`server: ${URL_BASE}  ·  agent: ${AGENT_ID}  ·  lang: ${LANG}`);
  speak('idle', DISCLAIMER[LANG]);
  console.log('\nPush-to-talk: type a symptom and press Enter ("press the button"). `/es` or `/en` switches language.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '🟢 press & talk> ' });
  rl.prompt();
  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) return rl.prompt();
    if (text === '/es' || text === '/en') {
      LANG = text.slice(1);
      speak('idle', DISCLAIMER[LANG]);
      return rl.prompt();
    }
    await pushToTalk(text, token);
    console.log('');
    rl.prompt();
  });
  rl.on('close', () => {
    console.log('\n(idle — session reset, nothing stored)');
    process.exit(0);
  });
}

main();
