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
  },
  console: {
    welcome: 'Welcome',
    superAdmin: 'Super-admin',
    createAgent: 'Create a triage agent',
  },
};

export type Dict = typeof en;
