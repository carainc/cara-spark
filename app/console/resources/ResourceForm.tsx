'use client';

/**
 * Upload form for referral resources (T12). Client component using useActionState so PHI-rejection
 * and "stored without embedding" feedback render inline. The PHI warning is shown up front — public
 * resources only.
 */
import { useActionState } from 'react';
import { addResource, type AddResourceState } from './actions';
import type { Dict } from '@/lib/i18n';

const initial: AddResourceState = { ok: false };

export function ResourceForm({ t, keyConfigured }: { t: Dict['resources']; keyConfigured: boolean }) {
  const [state, formAction, pending] = useActionState(addResource, initial);

  return (
    <form action={formAction} className="rounded-lg border border-gray-200 p-4">
      <h2 className="font-semibold">{t.addTitle}</h2>
      <p className="mt-1 text-xs text-crisis">{t.noPhiWarning}</p>
      {!keyConfigured && <p className="mt-1 text-xs text-amber-700">{t.keyMissing}</p>}

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-sm text-gray-600">{t.fieldTitle}</span>
          <input
            name="title"
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">{t.fieldBody}</span>
          <textarea
            name="body"
            required
            rows={4}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        <div className="flex gap-3">
          <label className="block flex-1">
            <span className="text-sm text-gray-600">{t.fieldCategory}</span>
            <input
              name="category"
              placeholder="food / housing / clinic"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm text-gray-600">{t.fieldLanguage}</span>
            <select name="language" className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm">
              <option value="EN">EN</option>
              <option value="ES">ES</option>
            </select>
          </label>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg disabled:opacity-50"
      >
        {t.submit}
      </button>

      {state.error === 'phi' && (
        <p data-testid="phi-rejected" className="mt-3 rounded-md bg-crisis/10 px-3 py-2 text-sm text-crisis">
          {t.rejected}
        </p>
      )}
      {state.ok && (
        <p className="mt-3 rounded-md bg-brand/10 px-3 py-2 text-sm text-brand">
          {t.added}
          {state.storedWithoutEmbedding ? ` ${t.keyMissing}` : ''}
        </p>
      )}
    </form>
  );
}
