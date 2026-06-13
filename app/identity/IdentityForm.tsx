'use client';

/**
 * Identity verification form (T6, tk-0006) — the browser side of model-blind identity.
 *
 * Name + DOB live in LOCAL component state only and are submitted straight to the server actions
 * (requestIdentityOtp / verifyIdentityOtp). They are cleared once a challenge is issued. The only
 * value this component ever surfaces on success is the model-safe { verified, opaqueRef }.
 */

import { useState, useTransition } from 'react';
import { requestIdentityOtp, verifyIdentityOtp } from './actions';
import type { ModelIdentityContext } from '@/lib/identity/model-context';
import type { IdentityCopy } from './copy';

type Step = 'claim' | 'code' | 'done';
type Channel = 'sms' | 'email';

export function IdentityForm({ t }: { t: IdentityCopy }) {
  const [step, setStep] = useState<Step>('claim');
  const [channel, setChannel] = useState<Channel>('sms');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [destination, setDestination] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [identity, setIdentity] = useState<ModelIdentityContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reset() {
    setStep('claim');
    setFullName('');
    setDateOfBirth('');
    setDestination('');
    setCode('');
    setChallengeId('');
    setIdentity(null);
    setError(null);
  }

  function onSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await requestIdentityOtp({
        fullName,
        dateOfBirth,
        channel,
        phone: channel === 'sms' ? destination : undefined,
        email: channel === 'email' ? destination : undefined,
      });
      if (!res.ok || !res.challengeId) {
        setError(t.errors[res.error ?? 'send_failed'] ?? t.errors.send_failed);
        return;
      }
      setChallengeId(res.challengeId);
      // Clear the raw claim from the browser once the challenge exists — it lives server-side now.
      setFullName('');
      setDateOfBirth('');
      setDestination('');
      setStep('code');
    });
  }

  function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await verifyIdentityOtp({ challengeId, code });
      if (!res.ok || !res.identity) {
        setError(t.errors[res.error ?? 'verification_failed'] ?? t.errors.verification_failed);
        return;
      }
      setIdentity(res.identity);
      setCode('');
      setStep('done');
    });
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold">{t.title}</h1>
      <p className="mt-2 text-sm text-gray-600">{t.intro}</p>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {step === 'claim' && (
        <form onSubmit={onSendCode} className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="font-medium">{t.fullName}</span>
            <input
              type="text"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">{t.dateOfBirth}</span>
            <input
              type="date"
              required
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <fieldset className="text-sm">
            <legend className="font-medium">{t.channel}</legend>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-2">
                <input type="radio" name="channel" checked={channel === 'sms'} onChange={() => setChannel('sms')} />
                {t.sms}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="channel" checked={channel === 'email'} onChange={() => setChannel('email')} />
                {t.email}
              </label>
            </div>
          </fieldset>
          <label className="block text-sm">
            <span className="font-medium">{channel === 'sms' ? t.phone : t.emailAddr}</span>
            <input
              type={channel === 'sms' ? 'tel' : 'email'}
              required
              autoComplete={channel === 'sms' ? 'tel' : 'email'}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
          >
            {pending ? t.sending : t.sendCode}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={onVerify} className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="font-medium">{t.code}</span>
            <input
              type="text"
              inputMode="numeric"
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 tracking-widest"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
          >
            {pending ? t.verifying : t.verify}
          </button>
        </form>
      )}

      {step === 'done' && identity && (
        <div className="mt-6 rounded-md border border-green-200 bg-green-50 px-4 py-4">
          <p className="font-medium text-green-800">✓ {t.verified}</p>
          {/* Display the OPAQUE ref only — there is no PHI to show. */}
          <p className="mt-1 break-all text-xs text-green-700">
            {t.refLabel}: <code>{identity.opaqueRef}</code>
          </p>
          <button type="button" onClick={reset} className="mt-3 text-sm underline">
            {t.startOver}
          </button>
        </div>
      )}
    </div>
  );
}
