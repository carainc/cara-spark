/**
 * Lane D / T7 — the MODEL'S HALF of the loop. The model PROPOSES; the engine DECIDES.
 *
 * THE THESIS, enforced in code:
 *  - The model (Opus 4.8) reads the conversation and emits ONLY typed EvidenceFacts + a RiskEstimate,
 *    via a single FORCED tool call (`propose_assessment`). It is structurally unable to return free
 *    prose as the decision, and the tool schema has NO field for an AllowedAction — the model cannot
 *    pick the disposition. `adjudicate()` (engine) does that, downstream in loop.ts.
 *  - MODEL-BLIND: the payload assembled here contains symptoms only. Name / DOB / phone / email are
 *    NEVER sent. Identity is the opaque { verified, opaqueRef } block from toModelIdentityContext.
 *    The model is also instructed never to ask for identifiers. (Grep-absent test: tests/agent-loop.)
 *
 * Opus 4.8 surface (per the claude-api skill): structured output via FORCED tool_choice. Extended/
 * adaptive thinking is INCOMPATIBLE with forced tool use — the API 400s ("Thinking may not be enabled
 * when tool_choice forces tool use") — so we send NO `thinking`. No temperature/top_p/top_k (Opus 4.8
 * rejects them). The single SDK call is injected (`createMessage`) so vitest mocks it with zero network.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import {
  riskEstimateSchema,
  DEFAULT_SOURCE_TRUST,
  type EvidenceFact,
  type EvidenceSource,
  type RiskEstimate,
} from '@/engine/types';
import type { ModelIdentityContext } from '@/lib/identity/model-context';
import { z } from 'zod';

/** The model id is pinned. Opus 4.8 — the model proposes; it never decides. */
export const TRIAGE_MODEL = 'claude-opus-4-8';

/** Bilingual conversation language — the model replies in the caller's language. */
export type AgentLang = 'en' | 'es';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * The tool the model is FORCED to call. Note what is absent: there is no `action` / `disposition`
 * field. The model proposes structured evidence + a probabilistic risk estimate; the deterministic
 * engine maps those to an AllowedAction. This shape is the contract boundary.
 */
export const PROPOSE_TOOL_NAME = 'propose_assessment';

export const PROPOSE_TOOL: Anthropic.Tool = {
  name: PROPOSE_TOOL_NAME,
  description:
    'Record the structured evidence and a risk estimate extracted from the conversation. ' +
    'You PROPOSE evidence and probabilities only — you do NOT choose what the patient should do. ' +
    'A separate deterministic safety engine decides the disposition from this.',
  input_schema: {
    type: 'object',
    properties: {
      evidence: {
        type: 'array',
        description:
          'Typed clinical facts extracted from the conversation. Each fact is a factType + value. ' +
          'NEVER include the patient name, date of birth, phone, email, address, or any identifier. ' +
          'Use these factTypes when they apply: patient_age_months (number), vital_temperature ' +
          '(number, °F), symptom (string code or phrase), duration (string), severity (string), ' +
          'chief_complaint (string), condition (string), mental_health (string code), ' +
          'lab_potassium/lab_sodium/lab_glucose (number).',
        items: {
          type: 'object',
          properties: {
            factType: { type: 'string', description: 'e.g. patient_age_months, vital_temperature, symptom' },
            value: {
              description: 'number for ages/vitals/labs; string for symptoms/duration/etc.',
              anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
            },
            confidence: {
              type: 'number',
              description: '0..1 — how confident you are this fact is correct.',
            },
          },
          required: ['factType', 'value'],
        },
      },
      risk: {
        type: 'object',
        description: 'Your probabilistic risk estimate (π). Probabilities need not sum to 1.',
        properties: {
          pRoutine: { type: 'number', description: '0..1 probability this is routine.' },
          pUrgent: { type: 'number', description: '0..1 probability this is urgent.' },
          pCritical: { type: 'number', description: '0..1 probability this is critical/emergent.' },
          confidence: { type: 'number', description: '0..1 your overall confidence.' },
          oodScore: { type: 'number', description: '0..1 how out-of-distribution / unusual this case is.' },
          evidenceCoverageScore: {
            type: 'number',
            description: '0..1 how complete the evidence is for a confident assessment.',
          },
          reasonCodes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short machine-readable reason tags (no PHI, no free prose).',
          },
        },
        required: [
          'pRoutine',
          'pUrgent',
          'pCritical',
          'confidence',
          'oodScore',
          'evidenceCoverageScore',
          'reasonCodes',
        ],
      },
    },
    required: ['evidence', 'risk'],
  },
};

/** Zod guard for the raw tool input the model returns (defensive — the model may drift). */
const proposedEvidenceItemSchema = z.object({
  factType: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  confidence: z.number().min(0).max(1).optional(),
});

const proposedRiskSchema = riskEstimateSchema.omit({ modelVersion: true }).extend({
  // The model supplies these; modelVersion is stamped server-side from the API response.
  reasonCodes: z.array(z.string()),
});

const proposeInputSchema = z.object({
  evidence: z.array(proposedEvidenceItemSchema),
  risk: proposedRiskSchema,
});

export type ProposeInput = z.infer<typeof proposeInputSchema>;

/**
 * The system prompt. It (1) tells the model it PROPOSES and never decides, (2) hard-forbids asking
 * for or echoing identifiers (model-blindness), (3) sets the reply language. It is intentionally
 * NON-prescriptive about clinical thresholds — those live in the deterministic engine, not here.
 */
export function buildSystemPrompt(lang: AgentLang, identity: ModelIdentityContext): string {
  const language = lang === 'es' ? 'Spanish' : 'English';
  // identity is the model-safe block ONLY ({ verified, opaqueRef, method }) — no PHI, by construction.
  const verifiedLine = identity.verified
    ? `The caller's identity was verified out-of-band (opaque ref ${identity.opaqueRef}).`
    : 'The caller is not identity-verified; that is fine for gathering symptoms.';
  return [
    'You are a medical-triage intake assistant for a community health center.',
    'Your ONLY job is to gather the patient\'s symptoms in conversation and extract structured facts.',
    'You do NOT diagnose, you do NOT treat, and you do NOT decide what the patient should do next —',
    'a separate deterministic safety engine makes every disposition. Never state or imply a',
    'disposition, urgency level, or that something is/ is not an emergency.',
    '',
    'Identity is handled out of band. NEVER ask for, repeat, or record the patient\'s name, date of',
    'birth, phone number, email, address, or any other identifier. If the patient volunteers one,',
    'do not store it as evidence and do not repeat it back.',
    verifiedLine,
    '',
    `Reply to the patient in ${language}.`,
    'On every turn, call the propose_assessment tool with the typed evidence and a risk estimate.',
    'Extract only what the patient actually said; do not invent vitals or ages.',
  ].join('\n');
}

/**
 * The injected SDK call shape. The real impl wraps `client.messages.create`; tests pass a stub that
 * returns a canned `Anthropic.Message` with a `tool_use` block — zero network.
 */
export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

/** Build the default CreateMessage from the SDK + ANTHROPIC_API_KEY (BYO key). Lazy-imports the SDK. */
export async function defaultCreateMessage(): Promise<CreateMessage> {
  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk');
  const client = new AnthropicSDK(); // reads ANTHROPIC_API_KEY from env
  return (params) => client.messages.create(params);
}

export interface ProposeResult {
  evidence: EvidenceFact[];
  riskEstimate: RiskEstimate;
  /** The model's natural-language reply text (bilingual), if any — used only for the chat bubble. */
  assistantText: string;
  modelVersion: string;
}

/**
 * Run ONE model turn: assemble a PHI-free payload, force the propose tool, parse the typed proposal
 * into engine-ready EvidenceFacts + RiskEstimate. Throws if the model returns no usable tool call.
 *
 * `source` defaults to user_chat (low trust) — the engine's source-trust model treats chat as low.
 */
export async function proposeAssessment(args: {
  createMessage: CreateMessage;
  lang: AgentLang;
  identity: ModelIdentityContext;
  history: ChatTurn[];
  traceId?: string;
  source?: EvidenceSource;
}): Promise<ProposeResult> {
  const { createMessage, lang, identity, history } = args;
  const traceId = args.traceId ?? randomUUID();
  const source: EvidenceSource = args.source ?? 'user_chat';

  const system = buildSystemPrompt(lang, identity);
  const messages: Anthropic.MessageParam[] = history.map((t) => ({ role: t.role, content: t.text }));

  // Structured output via FORCED tool_choice. The API forbids extended/adaptive thinking while tool
  // use is forced ("Thinking may not be enabled when tool_choice forces tool use" → 400), so we send
  // NO `thinking` here. No sampling params (Opus 4.8 rejects temperature/top_p/top_k).
  const response = await createMessage({
    model: TRIAGE_MODEL,
    max_tokens: 2048,
    system,
    tools: [PROPOSE_TOOL],
    tool_choice: { type: 'tool', name: PROPOSE_TOOL_NAME },
    messages,
  });

  return parseProposal(response, { traceId, source });
}

/**
 * Pure parser: an Anthropic.Message → engine-ready facts + risk. Separated so tests can exercise it
 * directly against canned messages. Tolerant of Unicode/slash escaping (we read parsed `input`, never
 * raw strings — per the claude-api skill's tool-JSON guidance).
 */
export function parseProposal(
  response: Anthropic.Message,
  opts: { traceId: string; source: EvidenceSource },
): ProposeResult {
  const modelVersion = response.model || TRIAGE_MODEL;

  let toolInput: unknown;
  let assistantText = '';
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === PROPOSE_TOOL_NAME) {
      toolInput = block.input;
    } else if (block.type === 'text') {
      assistantText += block.text;
    }
  }

  if (toolInput === undefined) {
    throw new Error('Model did not call propose_assessment — cannot adjudicate without typed evidence.');
  }

  const parsed = proposeInputSchema.safeParse(toolInput);
  if (!parsed.success) {
    throw new Error(`propose_assessment input failed validation: ${parsed.error.message}`);
  }

  const now = new Date().toISOString();
  const evidence: EvidenceFact[] = parsed.data.evidence.map((e, i) => ({
    id: `${opts.traceId}-m${i}`,
    factType: e.factType,
    value: e.value,
    confidence: e.confidence ?? 0.6,
    source: opts.source,
    sourceTrust: DEFAULT_SOURCE_TRUST[opts.source],
    verified: false,
    createdAt: now,
    modelVersion,
    traceId: opts.traceId,
  }));

  const riskEstimate: RiskEstimate = {
    pRoutine: parsed.data.risk.pRoutine,
    pUrgent: parsed.data.risk.pUrgent,
    pCritical: parsed.data.risk.pCritical,
    confidence: parsed.data.risk.confidence,
    oodScore: parsed.data.risk.oodScore,
    evidenceCoverageScore: parsed.data.risk.evidenceCoverageScore,
    reasonCodes: parsed.data.risk.reasonCodes,
    modelVersion,
  };

  return { evidence, riskEstimate, assistantText, modelVersion };
}
