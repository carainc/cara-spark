/** English UI + guidance + crisis-footer strings. Bilingual EN/ES is a CORE requirement. */
export const en = {
  lang: 'en',
  langName: 'English',
  app: {
    name: 'Cara Spark',
    tagline: 'Failsafe triage, for everyone who can reach a phone or a screen.',
  },
  footer: {
    notMedicalAdviceTitle: 'Not medical advice',
    notMedicalAdvice:
      'This tool provides decision support only. It is not medical advice and not a substitute for professional care or emergency services.',
    emergency: 'If this is an emergency, call 911 or go to the nearest emergency department.',
    crisisTitle: 'Crisis resources',
    crisis988: '988 — Suicide & Crisis Lifeline (call or text, 24/7).',
    crisisText: 'Text HOME to 741741 — Crisis Text Line.',
  },
  toggle: { switchTo: 'Español', label: 'Language' },
  login: {
    title: 'Sign in',
    google: 'Continue with Google',
    note: 'The first person to sign in becomes the super-admin and invites the rest.',
    or: 'or',
    email: 'Email',
    password: 'Password',
    passwordSignIn: 'Sign in with email',
  },
  console: {
    welcome: 'Welcome',
    superAdmin: 'Super-admin',
    createAgent: 'Create a triage agent',
  },
  calls: {
    title: 'Call audit trail',
    subtitle: 'Every disposition is made by the deterministic engine, provable against the policy checksum.',
    empty: 'No calls recorded yet.',
    channel: 'Channel',
    language: 'Language',
    disposition: 'Disposition',
    started: 'Started',
    interventions: 'Engine interventions',
    viewTrail: 'View trail',
    backToCalls: 'All calls',
    step: 'Step',
    modelProposed: 'Model proposed',
    engineDecided: 'Engine decided',
    ruleFired: 'Rule fired',
    cannedAction: 'Canned escalation',
    intervened: 'Engine intervened',
    noIntervention: 'No intervention — engine confirmed the model',
    redFlagEscalation: 'Red flag fired → forced escalation',
    overruled: 'Engine overruled the model’s proposed disposition',
    blocked: 'Action blocked → human handoff (fail-closed)',
    bundleVerified: 'Checksum verified',
    bundleFailed: 'Checksum FAILED — policy may have been altered',
    bundleVersion: 'Policy version',
    evidence: 'Evidence',
    risk: 'Model risk estimate',
    verifyNote: 'Recomputed from the policy bundle and matched the stored checksum.',
  },
  resources: {
    title: 'Referral resources',
    subtitle:
      'Community resources (food banks, clinics) the agent may cite in a referral. Advisory only — they never change a clinical disposition.',
    empty: 'No referral resources yet.',
    addTitle: 'Add a referral resource',
    fieldTitle: 'Title',
    fieldBody: 'Details',
    fieldCategory: 'Category (optional)',
    fieldLanguage: 'Language',
    submit: 'Add resource',
    noPhiWarning: 'Public resources only. Do not paste any patient information — PHI-shaped uploads are rejected.',
    rejected: 'Upload rejected: remove personal identifiers (no names, DOB, SSN, MRN, or phone tied to a person).',
    keyMissing: 'Embedding key not configured. Set OPENAI_API_KEY to enable retrieval; resources are stored either way.',
    added: 'Resource added.',
    category: 'Category',
    decisionInert: 'Advisory · cannot change a disposition',
  },
  // The conversational triage agent (Lane D / T7). The MODEL proposes; the deterministic ENGINE decides.
  agent: {
    intro:
      'Describe what is going on. This tool only gathers information and gives you a safe next step — it never diagnoses or treats. Do not share your name or date of birth.',
    placeholder: 'Type what is happening (symptoms, how long, how severe)…',
    send: 'Send',
    thinking: 'Reviewing…',
    youLabel: 'You',
    agentLabel: 'Cara Spark',
    restart: 'Start over',
    errorGeneric: 'Something went wrong reviewing that. Please try again, or call your clinic. If this is an emergency, call 911.',
    // Canned guidance per AllowedAction — the ONLY clinical text the agent emits. The model cannot write these.
    guidance: {
      SELF_CARE_INFO_ONLY:
        'Based on what you shared, this can usually be managed with self-care at home. Watch your symptoms, rest, and stay hydrated. If anything gets worse or you are worried, contact your clinic.',
      ROUTINE_REVIEW:
        'A member of the care team should review this. Please contact your clinic to arrange a routine visit. If your symptoms change or worsen, seek care sooner.',
      SAME_DAY_REVIEW:
        'You should be seen today. Please contact your clinic now to arrange a same-day visit. If your symptoms suddenly worsen, call 911 or go to the nearest emergency department.',
      IMMEDIATE_CLINIC_CALLBACK:
        'This needs prompt clinical attention. Your clinic should call you back right away. If you cannot reach them or your symptoms worsen, call 911 or go to the nearest emergency department.',
      ED_OR_911_GUIDANCE:
        'This may be an emergency. Call 911 now, or go to the nearest emergency department right away. Do not wait. If you are with someone who can help, ask them to stay with you.',
      BLOCK_AND_HUMAN_HANDOFF:
        'To keep you safe, this needs a person. A member of the care team will follow up. If this is an emergency, call 911 or go to the nearest emergency department now.',
    },
    // The provable-trace panel (demo beat 1). Renders EvidenceFacts → rule fired → π → AllowedAction.
    trace: {
      title: 'Why this decision',
      subtitle: 'The deterministic engine — not the model — made this decision. It is provable and replayable.',
      modelProposed: 'Model proposed (evidence + risk)',
      engineDecided: 'Engine decided',
      evidence: 'Evidence facts the model extracted',
      ruleFired: 'Red-flag rule fired',
      noRuleFired: 'No red-flag rule fired',
      cannedAction: 'forced action',
      risk: 'Risk estimate (π)',
      pRoutine: 'routine',
      pUrgent: 'urgent',
      pCritical: 'critical',
      confidence: 'confidence',
      action: 'Allowed action',
      bundle: 'Policy bundle',
      checksumOk: 'checksum ok',
      checksumFail: 'checksum FAILED',
      signatureOk: 'signature verified',
      signatureNone: 'unsigned (default bundle)',
      cannotSoften: 'The model cannot soften or override a fired red flag.',
      escalationLocked: 'Emergency escalation — locked by the engine.',
    },
  },
};

export type Dict = typeof en;
