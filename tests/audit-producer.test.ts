/**
 * T11 (CAR-2390) — audit PRODUCER (write path) + intervention detection.
 *
 * Mandatory cases covered here:
 *  - a completed call produces an AuditEntry (recordCall against a fake Prisma);
 *  - the infant-fever red-flag fixture renders the intervention highlighted with the rule id +
 *    canned action (detectIntervention / traceToAuditEntry);
 *  - the engine "overruled the model" signal fires when the model under-proposed.
 *
 * No live DB: a minimal in-memory fake Prisma. The trace comes from the REAL engine (adjudicate).
 */
import { describe, it, expect } from 'vitest';
import { adjudicate } from '@/engine';
import { DEFAULT_POLICY } from '@/engine/policy-bundle';
import type { AdjudicationTrace } from '@/engine/types';
import { CASES, buildEvidence, buildRisk } from '@/fixtures/cases';
import {
  traceToAuditEntry,
  detectIntervention,
  modelProposedAction,
  recordCall,
  recordVoiceCall,
} from '@/lib/audit/producer';

function caseTrace(id: string): AdjudicationTrace {
  const c = CASES.find((x) => x.id === id)!;
  return adjudicate({ evidence: buildEvidence(c), riskEstimate: buildRisk(c), bundle: DEFAULT_POLICY });
}

// --- Minimal in-memory fake Prisma (only the surface recordCall touches). ---
function fakePrisma() {
  const calls: any[] = [];
  const auditEntries: any[] = [];
  let cn = 0;
  let an = 0;
  return {
    calls,
    auditEntries,
    call: {
      create: async ({ data }: { data: any }) => {
        const row = { id: `call-${++cn}`, ...data };
        calls.push(row);
        return row;
      },
    },
    auditEntry: {
      create: async ({ data }: { data: any }) => {
        const row = { id: `ae-${++an}`, ...data };
        auditEntries.push(row);
        return row;
      },
    },
  } as any;
}

describe('detectIntervention — infant-fever red flag (demo beat 2-replay)', () => {
  const trace = caseTrace('infant-fever-en');

  it('flags the red-flag escalation with the firing rule id and canned action', () => {
    const result = detectIntervention(trace, DEFAULT_POLICY);
    expect(result.intervened).toBe(true);
    expect(result.kinds).toContain('red_flag_escalation');
    expect(result.ruleIdsFired).toContain('infant-fever-floor');
    // canned action the engine forced
    expect(result.engineAction).toBe('ED_OR_911_GUIDANCE');
  });

  it('also detects that the engine OVERRULED the model (model proposed low-risk routine)', () => {
    // the fixture's model proposes low risk → without red flags it would be self-care/routine.
    const proposed = modelProposedAction(trace.riskEstimate, DEFAULT_POLICY);
    expect(proposed).not.toBe('ED_OR_911_GUIDANCE');
    const result = detectIntervention(trace, DEFAULT_POLICY);
    expect(result.kinds).toContain('engine_overruled_model');
    expect(result.modelProposedAction).toBe(proposed);
  });
});

describe('traceToAuditEntry — pure mapping', () => {
  it('maps a red-flag trace into an AuditEntry row with intervention=true + rule ids + checksum', () => {
    const trace = caseTrace('infant-fever-en');
    const row = traceToAuditEntry(trace, 0, DEFAULT_POLICY);
    expect(row.seq).toBe(0);
    expect(row.intervention).toBe(true);
    expect(row.ruleIdsFired).toContain('infant-fever-floor');
    expect(row.decisionJson.action).toBe('ED_OR_911_GUIDANCE');
    expect(row.bundleVersion).toBe(DEFAULT_POLICY.metadata.policyVersion);
    expect(row.bundleChecksum).toBe(DEFAULT_POLICY.metadata.checksum);
    // the stored evidence is the structured trace, not raw prose
    expect(Array.isArray(row.evidenceJson)).toBe(true);
  });

  it('maps a benign trace (common cold) with intervention=false', () => {
    const trace = caseTrace('common-cold-en');
    const row = traceToAuditEntry(trace, 0, DEFAULT_POLICY);
    expect(row.intervention).toBe(false);
    expect(row.ruleIdsFired).toHaveLength(0);
  });
});

describe('recordCall — a completed call produces a Call + AuditEntry', () => {
  it('persists one Call and one AuditEntry per trace, with the final disposition', async () => {
    const prisma = fakePrisma();
    const trace = caseTrace('infant-fever-en');
    const result = await recordCall(prisma, {
      agentId: 'agent-1',
      channel: 'PHONE',
      language: 'EN',
      identityRef: 'opaque-ref-xyz',
      transcriptRef: 'transcript://synthetic/abc',
      traces: [trace],
      bundle: DEFAULT_POLICY,
    });

    expect(result.callId).toBe('call-1');
    expect(result.auditEntryIds).toHaveLength(1);
    expect(result.disposition).toBe('ED_OR_911_GUIDANCE');
    expect(result.interventionCount).toBe(1);

    // the persisted Call carries the opaque refs, NOT raw identity/transcript
    expect(prisma.calls[0].identityRef).toBe('opaque-ref-xyz');
    expect(prisma.calls[0].transcriptRef).toBe('transcript://synthetic/abc');
    expect(prisma.calls[0].disposition).toBe('ED_OR_911_GUIDANCE');

    // the AuditEntry carries the intervention flag + rule ids + checksum
    const ae = prisma.auditEntries[0];
    expect(ae.callId).toBe('call-1');
    expect(ae.intervention).toBe(true);
    expect(ae.ruleIdsFired).toContain('infant-fever-floor');
    expect(ae.bundleChecksum).toBe(DEFAULT_POLICY.metadata.checksum);
  });

  it('records a multi-turn call with one ordered AuditEntry per turn', async () => {
    const prisma = fakePrisma();
    const t0 = caseTrace('common-cold-en');
    const t1 = caseTrace('infant-fever-en');
    const result = await recordCall(prisma, {
      agentId: 'agent-1',
      channel: 'CHAT',
      traces: [t0, t1],
      bundle: DEFAULT_POLICY,
    });
    expect(result.auditEntryIds).toHaveLength(2);
    expect(prisma.auditEntries.map((a: any) => a.seq)).toEqual([0, 1]);
    // disposition is the LAST turn's action
    expect(result.disposition).toBe('ED_OR_911_GUIDANCE');
    expect(result.interventionCount).toBe(1); // only the infant-fever turn intervened
  });
});

describe('recordVoiceCall — frozen PostCallResult seam', () => {
  it('accepts the voice worker post-call shape and drops it into the audit trail (ES, PHONE)', async () => {
    const prisma = fakePrisma();
    // chest-pain-es: the MODEL proposes high pCritical AND the engine escalates to ED — they AGREE,
    // so this turn is correctly NOT an intervention (the engine confirmed the model). The audit
    // trail still records the full trace + checksum.
    const trace = caseTrace('chest-pain-es');
    const result = await recordVoiceCall(
      prisma,
      {
        agentId: 'agent-9',
        language: 'es',
        disposition: 'ED_OR_911_GUIDANCE',
        trace,
        transcriptRef: 'transcript://synthetic/es-1',
      },
      DEFAULT_POLICY,
    );
    expect(result.disposition).toBe('ED_OR_911_GUIDANCE');
    expect(prisma.calls[0].language).toBe('ES');
    expect(prisma.calls[0].channel).toBe('PHONE');
    // engine agreed with the model → no intervention, but the entry is persisted + checksummed
    expect(prisma.auditEntries[0].intervention).toBe(false);
    expect(prisma.auditEntries[0].bundleChecksum).toBe(DEFAULT_POLICY.metadata.checksum);
  });

  it('records an intervention when the voice trace is the infant-fever red flag (EN)', async () => {
    const prisma = fakePrisma();
    const trace = caseTrace('infant-fever-en');
    await recordVoiceCall(
      prisma,
      { agentId: 'agent-9', language: 'en', disposition: 'ED_OR_911_GUIDANCE', trace },
      DEFAULT_POLICY,
    );
    expect(prisma.auditEntries[0].intervention).toBe(true);
    expect(prisma.auditEntries[0].ruleIdsFired).toContain('infant-fever-floor');
  });
});
