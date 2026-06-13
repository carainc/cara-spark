/**
 * Cara comms provider (T5, tk-0005) — the default `CommsProvider` impl (lib/providers/types.ts,
 * FROZEN). Outbound SMS/email + OTP request/verify ride the Cara proxy with one key.
 *
 * SAFETY:
 *  - Raw destinations (phone/email) and OTP codes are NEVER logged.
 *  - `requestOtp` surfaces a rate-limit (HTTP 429) as a distinct, typed error so the caller can
 *    back off without leaking the destination.
 *  - `verifyOtp` is FAIL-CLOSED: any error or non-affirmative proxy response → { verified: false }.
 */

import type { CommsProvider, CommsVendor, SendResult } from '@/lib/providers/types';
import { CaraClient, CaraRequestError, redactError } from './client';

interface ProxySendResponse {
  id?: string;
  messageId?: string;
}
interface ProxyOtpRequestResponse {
  challengeId?: string;
  id?: string;
  expiresAt?: string;
}
interface ProxyOtpVerifyResponse {
  verified?: boolean;
  status?: string;
}

/** Thrown when the proxy rate-limits an OTP request (429). Carries NO destination. */
export class OtpRateLimitedError extends Error {
  readonly retryAfterSeconds?: number;
  constructor(retryAfterSeconds?: number) {
    super('OTP request rate-limited. Please wait before retrying.');
    this.name = 'OtpRateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class CaraCommsProvider implements CommsProvider {
  readonly vendor: CommsVendor;
  private readonly client: CaraClient;

  constructor(client: CaraClient, vendor: CommsVendor = 'cara') {
    this.client = client;
    this.vendor = vendor;
  }

  async sendSms(to: string, body: string): Promise<SendResult> {
    try {
      const data = await this.client.post<ProxySendResponse>('/comms/sms', { to, body });
      return { ok: true, providerMessageId: data.messageId ?? data.id };
    } catch (err) {
      return { ok: false, error: redactError(err) };
    }
  }

  async sendEmail(to: string, subject: string, body: string): Promise<SendResult> {
    try {
      const data = await this.client.post<ProxySendResponse>('/comms/email', { to, subject, body });
      return { ok: true, providerMessageId: data.messageId ?? data.id };
    } catch (err) {
      return { ok: false, error: redactError(err) };
    }
  }

  /**
   * Request an OTP over the chosen channel. The destination is sent server→proxy and never logged.
   * A 429 becomes a typed OtpRateLimitedError so the caller can rate-limit the UX.
   */
  async requestOtp(to: string, channel: 'sms' | 'email'): Promise<{ challengeId: string; expiresAt: string }> {
    try {
      const data = await this.client.post<ProxyOtpRequestResponse>('/comms/otp/request', { to, channel });
      const challengeId = data.challengeId ?? data.id;
      if (!challengeId) {
        throw new CaraRequestError(502, 'OTP request: proxy returned no challengeId.');
      }
      return {
        challengeId,
        expiresAt: data.expiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    } catch (err) {
      if (err instanceof CaraRequestError && err.rateLimited) {
        throw new OtpRateLimitedError();
      }
      throw err;
    }
  }

  /**
   * Verify an OTP code. FAIL-CLOSED: any thrown error or any non-`true` proxy response yields
   * { verified: false }. The code is never logged.
   */
  async verifyOtp(challengeId: string, code: string): Promise<{ verified: boolean }> {
    try {
      const data = await this.client.post<ProxyOtpVerifyResponse>('/comms/otp/verify', {
        challengeId,
        code,
      });
      const verified = data.verified === true || data.status === 'verified';
      return { verified };
    } catch {
      // Fail closed — never let a transport error read as "verified".
      return { verified: false };
    }
  }
}
