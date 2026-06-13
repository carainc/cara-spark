import { getDict, type Lang } from '@/lib/i18n';

/**
 * Crisis + not-medical-advice footer. Rendered at the LAYOUT level so it is structurally
 * impossible to ship a page without it (runbook safety non-negotiable). Bilingual EN/ES.
 *
 * Design (tk-0015): a high-contrast crisis band with a solid left accent bar — it reads as
 * load-bearing, not decorative. The emergency line and 988 lifeline get the strongest emphasis
 * because they are the resources a patient in crisis must find fastest. Type stays large and
 * legible (accessibility is the thesis). data-testid + role are preserved exactly.
 */
export function SafetyFooter({ lang }: { lang: Lang }) {
  const t = getDict(lang).footer;
  return (
    <footer
      role="contentinfo"
      data-testid="safety-footer"
      className="mt-auto border-t-2 border-crisis/30 bg-crisis/5"
    >
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="flex gap-4 border-l-4 border-crisis pl-4">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold text-crisis">{t.notMedicalAdviceTitle}</p>
            <p className="mt-1 max-w-prose text-ink-700">{t.notMedicalAdvice}</p>
            <p className="mt-2 font-semibold text-ink-900">{t.emergency}</p>

            <p className="mt-4 text-stamp font-semibold uppercase tracking-wide text-crisis">{t.crisisTitle}</p>
            <ul className="mt-1.5 space-y-1.5">
              <li className="flex items-start gap-2 text-ink-900">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-crisis" />
                <span className="font-medium">{t.crisis988}</span>
              </li>
              <li className="flex items-start gap-2 text-ink-700">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-crisis/60" />
                <span>{t.crisisText}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
