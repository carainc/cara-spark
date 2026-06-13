import type { Dict } from './en';

/** Spanish UI + guidance + crisis-footer strings. EN/ES end-to-end is the thesis, not a stretch. */
export const es: Dict = {
  lang: 'es',
  langName: 'Español',
  app: {
    name: 'Cara Spark',
    tagline: 'Triaje a prueba de fallos, para quien pueda llamar o usar una pantalla.',
  },
  footer: {
    notMedicalAdviceTitle: 'No es consejo médico',
    notMedicalAdvice:
      'Esta herramienta solo brinda apoyo para la toma de decisiones. No es consejo médico ni un sustituto de la atención profesional o los servicios de emergencia.',
    emergency: 'Si es una emergencia, llame al 911 o vaya a la sala de emergencias más cercana.',
    crisisTitle: 'Recursos de crisis',
    crisis988: '988 — Línea de Prevención del Suicidio y Crisis (llamada o texto, 24/7).',
    crisisText: 'Envíe AYUDA al 741741 — Línea de Texto de Crisis.',
  },
  toggle: { switchTo: 'English', label: 'Idioma' },
  login: {
    title: 'Iniciar sesión',
    google: 'Continuar con Google',
    note: 'La primera persona que inicie sesión será el super-administrador e invitará al resto.',
    or: 'o',
    email: 'Correo electrónico',
    passwordLabel: 'Contraseña',
    passwordSignIn: 'Iniciar sesión con correo',
  },
  console: {
    welcome: 'Bienvenido',
    superAdmin: 'Super-administrador',
    createAgent: 'Crear un agente de triaje',
  },
  calls: {
    title: 'Registro de auditoría de llamadas',
    subtitle: 'Cada decisión la toma el motor determinista, verificable contra la suma de verificación de la política.',
    empty: 'Aún no hay llamadas registradas.',
    channel: 'Canal',
    language: 'Idioma',
    disposition: 'Decisión',
    started: 'Inicio',
    interventions: 'Intervenciones del motor',
    viewTrail: 'Ver registro',
    backToCalls: 'Todas las llamadas',
    step: 'Paso',
    modelProposed: 'El modelo propuso',
    engineDecided: 'El motor decidió',
    ruleFired: 'Regla activada',
    cannedAction: 'Escalada predefinida',
    intervened: 'El motor intervino',
    noIntervention: 'Sin intervención — el motor confirmó al modelo',
    redFlagEscalation: 'Bandera roja activada → escalada forzada',
    overruled: 'El motor anuló la decisión propuesta por el modelo',
    blocked: 'Acción bloqueada → transferencia a humano (a prueba de fallos)',
    bundleVerified: 'Suma de verificación confirmada',
    bundleFailed: 'Suma de verificación FALLIDA — la política pudo ser alterada',
    bundleVersion: 'Versión de política',
    evidence: 'Evidencia',
    risk: 'Estimación de riesgo del modelo',
    verifyNote: 'Recalculada desde el paquete de política y coincide con la suma almacenada.',
  },
  resources: {
    title: 'Recursos de derivación',
    subtitle:
      'Recursos comunitarios (bancos de alimentos, clínicas) que el agente puede citar en una derivación. Solo informativo — nunca cambian una decisión clínica.',
    empty: 'Aún no hay recursos de derivación.',
    addTitle: 'Agregar un recurso de derivación',
    fieldTitle: 'Título',
    fieldBody: 'Detalles',
    fieldCategory: 'Categoría (opcional)',
    fieldLanguage: 'Idioma',
    submit: 'Agregar recurso',
    noPhiWarning: 'Solo recursos públicos. No pegue información del paciente — los archivos con forma de PHI se rechazan.',
    rejected: 'Carga rechazada: elimine los identificadores personales (sin nombres, fecha de nacimiento, SSN, MRN o teléfono de una persona).',
    keyMissing: 'Clave de incrustación no configurada. Configure OPENAI_API_KEY para habilitar la recuperación; los recursos se guardan igualmente.',
    added: 'Recurso agregado.',
    category: 'Categoría',
    decisionInert: 'Informativo · no puede cambiar una decisión',
  },
  kiosk: {
    disclaimer:
      'Hola, estoy aquí para ayudarle a decidir qué hacer. Esto no es atención de emergencia — si es una emergencia le ayudaré a llamar al 9 1 1. Presione el botón y dígame qué le pasa.',
    offline: 'No me puedo conectar en este momento — por favor busque al personal del lugar. Si es una emergencia, llame al 9 1 1.',
  },
  agent: {
    intro:
      'Describa qué está pasando. Esta herramienta solo recopila información y le da un próximo paso seguro — nunca diagnostica ni trata. No comparta su nombre ni su fecha de nacimiento.',
    placeholder: 'Escriba qué está pasando (síntomas, cuánto tiempo, qué tan grave)…',
    send: 'Enviar',
    thinking: 'Revisando…',
    youLabel: 'Usted',
    agentLabel: 'Cara Spark',
    restart: 'Empezar de nuevo',
    errorGeneric: 'Algo salió mal al revisar eso. Inténtelo de nuevo o llame a su clínica. Si es una emergencia, llame al 911.',
    guidance: {
      SELF_CARE_INFO_ONLY:
        'Según lo que compartió, esto suele poder manejarse con autocuidado en casa. Vigile sus síntomas, descanse e hidrátese. Si algo empeora o le preocupa, comuníquese con su clínica.',
      ROUTINE_REVIEW:
        'Un miembro del equipo de atención debería revisar esto. Comuníquese con su clínica para programar una visita de rutina. Si sus síntomas cambian o empeoran, busque atención antes.',
      SAME_DAY_REVIEW:
        'Debería ser atendido hoy. Comuníquese con su clínica ahora para una visita el mismo día. Si sus síntomas empeoran de repente, llame al 911 o vaya a la sala de emergencias más cercana.',
      IMMEDIATE_CLINIC_CALLBACK:
        'Esto necesita atención clínica pronta. Su clínica debería llamarle de inmediato. Si no puede comunicarse o sus síntomas empeoran, llame al 911 o vaya a la sala de emergencias más cercana.',
      ED_OR_911_GUIDANCE:
        'Esto puede ser una emergencia. Llame al 911 ahora, o vaya de inmediato a la sala de emergencias más cercana. No espere. Si hay alguien que pueda ayudar, pídale que se quede con usted.',
      BLOCK_AND_HUMAN_HANDOFF:
        'Para su seguridad, esto necesita una persona. Un miembro del equipo de atención le dará seguimiento. Si es una emergencia, llame al 911 o vaya a la sala de emergencias más cercana ahora.',
    },
    trace: {
      title: 'Por qué esta decisión',
      subtitle: 'El motor determinista — no el modelo — tomó esta decisión. Es verificable y reproducible.',
      modelProposed: 'El modelo propuso (evidencia + riesgo)',
      engineDecided: 'El motor decidió',
      evidence: 'Hechos de evidencia que extrajo el modelo',
      ruleFired: 'Regla de bandera roja activada',
      noRuleFired: 'No se activó ninguna bandera roja',
      cannedAction: 'acción forzada',
      risk: 'Estimación de riesgo (π)',
      pRoutine: 'rutina',
      pUrgent: 'urgente',
      pCritical: 'crítico',
      confidence: 'confianza',
      action: 'Acción permitida',
      bundle: 'Paquete de política',
      checksumOk: 'suma de verificación correcta',
      checksumFail: 'suma de verificación FALLIDA',
      signatureOk: 'firma verificada',
      signatureNone: 'sin firmar (paquete predeterminado)',
      cannotSoften: 'El modelo no puede suavizar ni anular una bandera roja activada.',
      escalationLocked: 'Escalada de emergencia — bloqueada por el motor.',
    },
    // Referencia informativa (demo beat 3 / tk-0019) — se agrega SOLO tras una disposición no urgente.
    // No modifica la decisión: estos recursos nunca cambian la recomendación clínica.
    referral: {
      title: 'Recursos comunitarios que podrían ser útiles',
      decisionInert: 'Informativo · no cambian la recomendación clínica',
    },
  },
};
