/**
 * Self-contained EN/ES copy for the identity-verification form (T6, tk-0006).
 *
 * Kept local to this feature (not in the shared lib/i18n Dict) so Lane C stays disjoint from the
 * foundation lane's dictionary. Reuses the app-level `cara_lang` cookie via getLang() in page.tsx.
 */

export type IdentityLang = 'en' | 'es';

/** Structural shape of one language block — widened from literals so EN and ES are interchangeable. */
export interface IdentityCopy {
  title: string;
  intro: string;
  fullName: string;
  dateOfBirth: string;
  channel: string;
  sms: string;
  email: string;
  phone: string;
  emailAddr: string;
  sendCode: string;
  code: string;
  verify: string;
  sending: string;
  verifying: string;
  verified: string;
  refLabel: string;
  startOver: string;
  errors: Record<string, string>;
}

export const identityCopy: Record<IdentityLang, IdentityCopy> = {
  en: {
    title: 'Verify your identity',
    intro:
      'Enter your name and date of birth to receive a one-time code. Your details are sent securely and are never shared with the assistant.',
    fullName: 'Full name',
    dateOfBirth: 'Date of birth',
    channel: 'Send code by',
    sms: 'Text message',
    email: 'Email',
    phone: 'Mobile number',
    emailAddr: 'Email address',
    sendCode: 'Send code',
    code: 'One-time code',
    verify: 'Verify',
    sending: 'Sending…',
    verifying: 'Verifying…',
    verified: 'Verified',
    refLabel: 'Reference',
    startOver: 'Start over',
    errors: {
      invalid_input: 'Please check the details you entered.',
      not_configured: 'Verification is not configured yet (CARA_API_KEY is not set).',
      rate_limited: 'Too many requests. Please wait a moment and try again.',
      send_failed: 'We could not send a code. Please try again.',
      verification_failed: 'That code did not match. Please try again.',
    } as Record<string, string>,
  },
  es: {
    title: 'Verifique su identidad',
    intro:
      'Ingrese su nombre y fecha de nacimiento para recibir un código de un solo uso. Sus datos se envían de forma segura y nunca se comparten con el asistente.',
    fullName: 'Nombre completo',
    dateOfBirth: 'Fecha de nacimiento',
    channel: 'Enviar código por',
    sms: 'Mensaje de texto',
    email: 'Correo electrónico',
    phone: 'Número de móvil',
    emailAddr: 'Dirección de correo',
    sendCode: 'Enviar código',
    code: 'Código de un solo uso',
    verify: 'Verificar',
    sending: 'Enviando…',
    verifying: 'Verificando…',
    verified: 'Verificado',
    refLabel: 'Referencia',
    startOver: 'Empezar de nuevo',
    errors: {
      invalid_input: 'Por favor revise los datos ingresados.',
      not_configured: 'La verificación aún no está configurada (CARA_API_KEY no está definida).',
      rate_limited: 'Demasiados intentos. Espere un momento e intente de nuevo.',
      send_failed: 'No pudimos enviar un código. Intente de nuevo.',
      verification_failed: 'Ese código no coincide. Intente de nuevo.',
    } as Record<string, string>,
  },
};
