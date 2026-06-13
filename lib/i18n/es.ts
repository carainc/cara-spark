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
  },
  console: {
    welcome: 'Bienvenido',
    superAdmin: 'Super-administrador',
    createAgent: 'Crear un agente de triaje',
  },
};
