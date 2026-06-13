import { getDict, type Lang } from '@/lib/i18n';

/**
 * Crisis + not-medical-advice footer. Rendered at the LAYOUT level so it is structurally
 * impossible to ship a page without it (runbook safety non-negotiable). Bilingual EN/ES.
 */
export function SafetyFooter({ lang }: { lang: Lang }) {
  const t = getDict(lang).footer;
  return (
    <footer
      role="contentinfo"
      data-testid="safety-footer"
      className="mt-auto border-t border-crisis/30 bg-crisis/5 px-4 py-4 text-sm text-gray-700"
    >
      <p className="font-semibold text-crisis">{t.notMedicalAdviceTitle}</p>
      <p className="mt-1">{t.notMedicalAdvice}</p>
      <p className="mt-1 font-medium">{t.emergency}</p>
      <p className="mt-2 font-semibold text-crisis">{t.crisisTitle}</p>
      <ul className="mt-1 list-disc pl-5">
        <li>{t.crisis988}</li>
        <li>{t.crisisText}</li>
      </ul>
    </footer>
  );
}
