/**
 * /api/kiosk/session — the kiosk ingress endpoint (T16 / CAR-2395).
 *
 * POST: one push-to-talk turn. Body is a `KioskSessionRequest` (agentId, lang, the transcribed/
 * typed utterance, an opaque sessionRef). The device authenticates with its DEVICE TOKEN (Bearer,
 * HMAC via VOICE_CONFIG_HMAC_SECRET) — NOT a user login (anonymous by design). We bridge into the
 * SAME agent loop (`runKioskSession` → `runTurn`): the model proposes, the DETERMINISTIC engine
 * decides, and we return policy-authored, bilingual, SPOKEN guidance the model can never soften.
 *
 * GET: the spoken bilingual disclaimer + crisis notice (the screenless equivalent of the crisis
 * footer the hard rules require on any kiosk surface). The box plays it on wake.
 *
 * The real Pi streams audio over a WebSocket and the server transcribes it (Deepgram, voice lane);
 * the `--sim` client (scripts/kiosk-sim.mjs) skips audio and POSTs typed text — same contract.
 * Node runtime required (HMAC via node:crypto). Voice path uses the OSS standalone — NEVER prod LiveKit.
 */
import { runKioskSession, type KioskAuditSink } from '@/lib/kiosk';
import type { KioskSessionRequest } from '@/lib/kiosk/types';
import { spokenDisclaimer } from '@/lib/kiosk/spoken';
import { defaultCreateMessage } from '@/lib/agent/extract';
import { recordCall } from '@/lib/audit/producer';
import { prisma } from '@/lib/db';
import { isLang } from '@/lib/i18n';
import { authorizeKioskDevice } from '../_auth';

export const runtime = 'nodejs';

/** GET → the spoken bilingual disclaimer + crisis notice the box plays on wake (no screen → spoken). */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const langParam = url.searchParams.get('lang') ?? '';
  // Greeting is ALWAYS bilingual; `lang` only picks which is primary. Default: both, EN first.
  const primary = isLang(langParam) ? langParam : 'en';
  const secondary = primary === 'en' ? 'es' : 'en';
  return Response.json(
    {
      disclaimer: { [primary]: spokenDisclaimer(primary), [secondary]: spokenDisclaimer(secondary) },
      // Crisis notice (hard rule: a crisis notice on any kiosk surface). Spelled for TTS.
      crisis: {
        en: 'If this is a mental-health crisis, call or text 9 8 8 — the Suicide and Crisis Lifeline, 24/7.',
        es: 'Si es una crisis de salud mental, llame o envíe un mensaje al 9 8 8 — la Línea de Crisis y Suicidio, las 24 horas.',
      },
    },
    { status: 200 },
  );
}

/** The Lane F audit sink: persist a kiosk session into the same no-PHI audit trail (channel=KIOSK). */
const auditSink: KioskAuditSink = {
  async record(input) {
    await recordCall(prisma, {
      agentId: input.agentId,
      channel: input.channel,
      language: input.language,
      identityRef: input.identityRef,
      traces: input.traces,
    });
  },
};

export async function POST(req: Request): Promise<Response> {
  let body: KioskSessionRequest;
  try {
    body = (await req.json()) as KioskSessionRequest;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body?.agentId || typeof body?.utterance !== 'string' || !body.utterance.trim()) {
    return Response.json({ error: 'missing required fields' }, { status: 400 });
  }

  // Device-token auth, bound to the requested agent. Anonymous — no user session.
  if (!authorizeKioskDevice(req, body.agentId)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const lang = isLang(body.lang) ? body.lang : 'en';

  try {
    const createMessage = await defaultCreateMessage();
    const result = await runKioskSession(
      { agentId: body.agentId, lang, utterance: body.utterance, sessionRef: body.sessionRef },
      { createMessage, audit: auditSink },
    );
    return Response.json(result, { status: 200 });
  } catch (err) {
    // Fail CLOSED to the safest spoken handoff — a screenless box must still tell the person what
    // to do (build guide §7: fail-safe, never silent). No PHI — message is the symbol only.
    const message = err instanceof Error ? err.message : 'session failed';
    return Response.json(
      {
        error: 'engine_unavailable',
        detail: message,
        failClosed: 'BLOCK_AND_HUMAN_HANDOFF',
        spoken: spokenDisclaimer(lang),
      },
      { status: 503 },
    );
  }
}
