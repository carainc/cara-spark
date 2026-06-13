/**
 * /identity (T6, tk-0006) — model-blind identity capture.
 *
 * Server component: picks the active language (shared cara_lang cookie) and renders the client
 * form. The crisis SafetyFooter renders at the layout level, so this page inherits it structurally.
 */

import { getLang } from '@/lib/i18n/server';
import { identityCopy } from './copy';
import { IdentityForm } from './IdentityForm';

export default async function IdentityPage() {
  const lang = await getLang();
  return (
    <section>
      <IdentityForm t={identityCopy[lang]} />
    </section>
  );
}
