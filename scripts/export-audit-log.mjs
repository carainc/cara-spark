#!/usr/bin/env node
/**
 * export-audit-log — export the FULL agent decision-trace audit trail (every recorded triage
 * session) as PHI-free JSON. This is the "export all sessions" tool: run it any time to get the
 * complete, current audit log; it is NOT a static snapshot.
 *
 * WHAT it exports (per call): the provable engine trace the audit viewer renders — evidence facts,
 * red-flag result, the model's risk estimate, the deterministic decision, the signed bundle
 * version + checksum, and the intervention flag. NO PHI: identity is the opaque identityRef only,
 * transcripts are never stored (transcriptRef pointer), and model-extracted fact values carry no
 * identifiers by construction.
 *
 * USAGE:
 *   pnpm export:audit                          # all sessions → stdout
 *   pnpm export:audit -- --out audit.json      # all sessions → file
 *   pnpm export:audit -- --limit 100           # most recent 100 sessions
 *   pnpm export:audit -- --agent <agentId>     # one agent only
 *   # On the standalone EC2 box (DB is in-container):
 *   sudo docker compose exec -T app node scripts/export-audit-log.mjs --out /tmp/audit.json
 *
 * Needs DATABASE_URL in the environment (the app/container already has it).
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const prisma = new PrismaClient();

async function main() {
  const limit = arg('limit') ? Number(arg('limit')) : undefined;
  const agentId = arg('agent');
  const out = arg('out');

  const calls = await prisma.call.findMany({
    where: agentId ? { agentId } : undefined,
    orderBy: { startedAt: 'desc' },
    ...(limit ? { take: limit } : {}),
  });
  const callIds = calls.map((c) => c.id);
  const entries = await prisma.auditEntry.findMany({
    where: { callId: { in: callIds } },
    orderBy: { seq: 'asc' },
  });
  const byCall = {};
  for (const e of entries) (byCall[e.callId] ||= []).push(e);

  const sessions = calls.map((c) => ({
    callId: c.id,
    agentId: c.agentId,
    channel: c.channel,
    language: c.language,
    disposition: c.disposition,
    startedAt: c.startedAt,
    endedAt: c.endedAt,
    identityRef: c.identityRef, // opaque, PHI-free
    transcriptRef: c.transcriptRef ?? null, // pointer only; no raw transcript persisted
    trace: (byCall[c.id] || []).map((e) => ({
      seq: e.seq,
      evidence: e.evidenceJson,
      redFlag: e.redFlagJson,
      risk: e.riskJson,
      decision: e.decisionJson,
      bundleVersion: e.bundleVersion,
      bundleChecksum: e.bundleChecksum,
      intervention: e.intervention,
      ruleIdsFired: e.ruleIdsFired,
    })),
  }));

  const payload = {
    exportedAt: new Date().toISOString(),
    sessionCount: sessions.length,
    note: 'PHI-free agent decision-trace audit trail. identityRef is opaque; transcripts are never persisted.',
    sessions,
  };
  const json = JSON.stringify(payload, null, 2) + '\n';
  if (out) {
    writeFileSync(out, json);
    process.stderr.write(`exported ${sessions.length} sessions → ${out}\n`);
  } else {
    process.stdout.write(json);
  }
}

main()
  .catch((e) => {
    process.stderr.write(`export-audit-log failed: ${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
