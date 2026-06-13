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
    passwordLabel: 'Password',
    passwordSignIn: 'Sign in with email',
  },
  console: {
    welcome: 'Welcome',
    superAdmin: 'Super-admin',
    createAgent: 'Create a triage agent',
    nav: {
      agents: 'Agents',
      resources: 'Resources',
      calls: 'Audit trail',
    },
    shellSubtitle: 'Configure failsafe triage agents. The engine owns every disposition.',
  },
  // Public landing (tk-0015). The thesis up front: the model proposes, the engine decides — provably.
  landing: {
    eyebrow: 'Open-source · self-hostable · BYO-key',
    headline: 'Triage you can prove,',
    headlineAccent: 'not just trust.',
    subhead:
      'A failsafe medical-triage agent for community health centers and the patients they serve. A deterministic engine — not the language model — makes every safety decision, and every decision is provable and replayable.',
    primaryCta: 'Create a triage agent',
    secondaryCta: 'See a live decision',
    pillarsTitle: 'Built for safety-net care',
    pillar1Title: 'The engine decides',
    pillar1Body: 'The model only proposes evidence. A signed policy engine adjudicates — red flags always dominate, and it fails closed to a human.',
    pillar2Title: 'Provable, replayable',
    pillar2Body: 'Every disposition carries a verification stamp: the policy version, a checksum, and a signature. Nothing is taken on faith.',
    pillar3Title: 'Built-in by default',
    pillar3Body: 'Bilingual EN/ES, no PHI in the model, and a crisis safety footer on every screen. Accessibility is the foundation, not an add-on.',
    traceDemoLabel: 'Engine decision — example',
    traceDemoModel: 'Model proposed',
    traceDemoEvidence: 'chest_pain = true · shortness_of_breath = true',
    traceDemoEngine: 'Engine decided',
    traceDemoLocked: 'Locked — the model cannot soften this.',
  },
  // Tabbed agent configuration (tk-0022; absorbs the tk-0017 bundle selector). Surfaces existing
  // backends only — channels (Lane E), the signed policy bundle (engine), corpus (Lane F), preview.
  agentConfig: {
    back: 'Agents',
    statusDraft: 'Draft',
    statusPublished: 'Published',
    statusArchived: 'Archived',
    saveChannels: 'Save channels',
    publish: 'Publish',
    published: 'Saved and published.',
    tabs: {
      general: 'General',
      channels: 'Channels',
      policies: 'Policies & Bundles',
      corpus: 'Corpus / RAG',
      preview: 'Preview',
    },
    general: {
      title: 'General',
      subtitle: 'How this agent identifies itself. Identity never touches a triage disposition.',
      nameLabel: 'Agent name',
      slugLabel: 'Public URL slug',
      languageLabel: 'Default language',
      personaLabel: 'Persona note',
      personaHelp:
        'A short tone note for the conversational voice. It never overrides the engine — the clinical text is always the canned, policy-authored guidance.',
      personaPlaceholder: 'e.g. Warm, plain-language, reassuring; speaks to a worried caregiver.',
      readonlyNote: 'Name and slug are set at creation in this build.',
    },
    channels: {
      title: 'Channels',
      subtitle: 'Turn delivery surfaces on or off. The deterministic engine runs identically on each.',
      chat: 'Chat (web)',
      voice: 'Voice (web)',
      phone: 'Phone',
      didLabel: 'Number (read-only)',
      didWhenEnabled: 'shown when enabled',
      didNote: 'Display only — Cara Spark never buys or writes a number, and never touches the production voice stack.',
    },
    policies: {
      title: 'Policy bundle',
      subtitle:
        'The signed policy bundle is the safety contract. The engine verifies its checksum and signature before every decision; the model can never edit it.',
      selectLabel: 'Active policy bundle',
      activeBadge: 'Active',
      defaultBadge: 'Signed default',
      versionLabel: 'Version',
      signedByLabel: 'Signed by',
      checksumLabel: 'Checksum',
      signatureLabel: 'Signature',
      signatureVerified: 'signature verified',
      signatureUnsigned: 'unsigned (default bundle)',
      checksumOk: 'checksum ok',
      rulesTitle: 'Red-flag rules in this bundle',
      ruleForces: 'forces',
      save: 'Set policy bundle',
      saved: 'Policy bundle updated.',
      lockNote: 'Red flags always dominate and the engine fails closed to a human. The model cannot soften a fired rule.',
      loadError: 'Could not load policy bundles.',
    },
    corpus: {
      title: 'Referral corpus',
      subtitle:
        'Community resources this agent may CITE in a referral. Advisory only — they never change a clinical disposition. PHI-shaped uploads are rejected.',
    },
    preview: {
      title: 'Preview',
      subtitle: 'The branded patient experience for this agent. A draft previews here before you publish.',
      open: 'Open full preview',
      draftNote: 'Preview reflects the current draft. The public page goes live only after you publish.',
    },
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
  // Kiosk (T16): a phone-less, account-less one-button box. No screen → the disclaimer is SPOKEN
  // every session (TTS-shaped: "9 1 1" is spelled out). Bilingual is core; both are spoken on wake.
  kiosk: {
    // The spoken greeting + not-emergency-care disclaimer, played on wake before the first press.
    disclaimer:
      "Hi, I'm here to help you figure out what to do. This is not emergency care — if this is an emergency I'll help you call 9 1 1. Press the button and tell me what's going on.",
    // Spoken when the box cannot reach the server. Fail-safe, never silent (build guide §7).
    offline: "I can't connect right now — please find on-site staff. If this is an emergency, call 9 1 1.",
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
    // Advisory referral (demo beat 3 / tk-0019) — appended AFTER a non-emergency disposition only.
    // Decision-inert: these resources never change the clinical recommendation.
    referral: {
      title: 'Community resources you may find helpful',
      decisionInert: 'Advisory · these do not change the clinical recommendation',
    },
  },
};

export type Dict = typeof en;
