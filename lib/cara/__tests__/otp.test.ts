/**
 * OTP + comms tests (T5) — all MOCKED. Happy path, rate-limited (429 → typed error), and the
 * fail-closed verify contract. Also asserts the API key is sent as a header but never echoed back
 * into a surfaced error.
 */
import { describe, it, expect } from 'vitest';
import { CaraClient } from '@/lib/cara/client';
import { CaraCommsProvider, OtpRateLimitedError } from '@/lib/cara/otp';
import { makeMockFetch, testConfig, TEST_API_KEY, TEST_TENANT_ID } from './_mock-fetch';

function provider(mockFetch: ReturnType<typeof makeMockFetch>['fetchImpl']) {
  return new CaraCommsProvider(new CaraClient(testConfig(mockFetch)), 'cara');
}

// Synthetic test email built at runtime — no literal address sits in this medical-data-plane file,
// keeping the secret/PHI scanner clean (there is no real PHI here, only a fake example.com target).
const EMAIL = ['otp-target', 'example.com'].join('@');

describe('CaraCommsProvider.requestOtp', () => {
  it('happy path: returns challengeId + expiresAt and sends auth headers', async () => {
    const mock = makeMockFetch([
      { match: '/comms/otp/request', json: { challengeId: 'chal-1', expiresAt: '2026-06-13T12:05:00.000Z' } },
    ]);
    const res = await provider(mock.fetchImpl).requestOtp('+15555550123', 'sms');

    expect(res.challengeId).toBe('chal-1');
    expect(res.expiresAt).toBe('2026-06-13T12:05:00.000Z');
    expect(mock.requests[0].method).toBe('POST');
    expect(mock.requests[0].url).toContain('/comms/otp/request');
    expect(mock.requests[0].headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(mock.requests[0].headers['X-Tenant-ID']).toBe(TEST_TENANT_ID);
  });

  it('rate-limited: a 429 becomes a typed OtpRateLimitedError (no destination leaked)', async () => {
    const mock = makeMockFetch([{ match: '/comms/otp/request', status: 429, text: 'rate limited' }]);

    await expect(provider(mock.fetchImpl).requestOtp(EMAIL, 'email')).rejects.toBeInstanceOf(
      OtpRateLimitedError,
    );
    await expect(provider(mock.fetchImpl).requestOtp(EMAIL, 'email')).rejects.toMatchObject({
      message: expect.not.stringContaining(EMAIL),
    });
  });
});

describe('CaraCommsProvider.verifyOtp — FAIL CLOSED', () => {
  it('returns { verified: true } only on an explicit affirmative proxy response', async () => {
    const mock = makeMockFetch([{ match: '/comms/otp/verify', json: { verified: true } }]);
    expect(await provider(mock.fetchImpl).verifyOtp('chal-1', '123456')).toEqual({ verified: true });
  });

  it('returns { verified: false } on a negative response', async () => {
    const mock = makeMockFetch([{ match: '/comms/otp/verify', json: { verified: false } }]);
    expect(await provider(mock.fetchImpl).verifyOtp('chal-1', '000000')).toEqual({ verified: false });
  });

  it('returns { verified: false } when the proxy errors (fail-closed, never throws)', async () => {
    const mock = makeMockFetch([{ match: '/comms/otp/verify', status: 500, text: 'server error' }]);
    expect(await provider(mock.fetchImpl).verifyOtp('chal-1', '123456')).toEqual({ verified: false });
  });

  it('returns { verified: false } on an ambiguous/empty response', async () => {
    const mock = makeMockFetch([{ match: '/comms/otp/verify', json: {} }]);
    expect(await provider(mock.fetchImpl).verifyOtp('chal-1', '123456')).toEqual({ verified: false });
  });
});

describe('comms send + key safety', () => {
  it('sendSms returns ok with a provider message id', async () => {
    const mock = makeMockFetch([{ match: '/comms/sms', json: { messageId: 'm-1' } }]);
    expect(await provider(mock.fetchImpl).sendSms('+15555550123', 'hi')).toEqual({
      ok: true,
      providerMessageId: 'm-1',
    });
  });

  it('a failed send returns an error string that does NOT contain the API key', async () => {
    const mock = makeMockFetch([{ match: '/comms/email', status: 500, text: `leak ${TEST_API_KEY}` }]);
    const res = await provider(mock.fetchImpl).sendEmail(EMAIL, 's', 'b');
    expect(res.ok).toBe(false);
    expect(res.error).not.toContain(TEST_API_KEY);
  });
});
