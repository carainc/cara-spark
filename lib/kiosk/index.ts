/**
 * Kiosk module barrel (T16 / CAR-2395). The kiosk is a new ingress CHANNEL that bridges into the
 * SAME agent loop + deterministic engine — anonymous, model-blind, bilingual, no-PHI.
 *   import { runKioskSession, verifyDeviceToken, spokenDisclaimer } from '@/lib/kiosk';
 */
export * from './types';
export * from './device-token';
export * from './spoken';
export * from './redact';
export {
  runKioskSession,
  mintSessionRef,
  KIOSK_SESSION_PREFIX,
  type KioskSessionDeps,
  type KioskAuditSink,
} from './session';
