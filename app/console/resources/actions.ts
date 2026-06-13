'use server';

/**
 * Server actions for referral-RAG resources (T12). Ingest runs the PHI gate → chunk → embed → store
 * pipeline from lib/rag. The embedding key is read from env inside the embedder and NEVER logged.
 * If no key is configured, the resource is stored WITHOUT an embedding (graceful degradation) so the
 * corpus is still authored; retrieval simply won't surface it until a key is set.
 *
 * This file is decision-inert by construction: it imports lib/rag (citations only), never the engine.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import {
  ingestResource,
  createOpenAIEmbedder,
  isEmbeddingConfigured,
  PhiRejectedError,
  pgStore,
  type ResourceLanguage,
} from '@/lib/rag';
import { assertNoPhi } from '@/lib/rag/phi';
import { getActiveTenantId } from '@/lib/audit/tenant';

export interface AddResourceState {
  ok: boolean;
  message?: string;
  error?: 'phi' | 'no_tenant' | 'invalid' | 'unknown';
  /** True when stored but not embedded (no key) — UI surfaces the "set OPENAI_API_KEY" notice. */
  storedWithoutEmbedding?: boolean;
}

export async function addResource(
  _prev: AddResourceState,
  formData: FormData,
): Promise<AddResourceState> {
  const tenantId = await getActiveTenantId();
  if (!tenantId) return { ok: false, error: 'no_tenant', message: 'No tenant in session.' };

  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim() || undefined;
  const language = (String(formData.get('language') ?? 'EN') as ResourceLanguage) === 'ES' ? 'ES' : 'EN';

  if (!title || !body) return { ok: false, error: 'invalid', message: 'Title and details are required.' };

  try {
    if (isEmbeddingConfigured()) {
      const embed = createOpenAIEmbedder();
      await ingestResource({ tenantId, title, body, category, language }, { store: pgStore(prisma), embed });
      revalidatePath('/console/resources');
      return { ok: true, message: 'added' };
    }

    // No embedding key: still PHI-gate, then store the resource without a vector.
    assertNoPhi(title);
    assertNoPhi(body);
    await prisma.referralResource.create({
      data: { tenantId, title, body, category: category ?? null, language },
    });
    revalidatePath('/console/resources');
    return { ok: true, message: 'added', storedWithoutEmbedding: true };
  } catch (e) {
    if (e instanceof PhiRejectedError) {
      // Carry the kinds, never the raw value.
      return { ok: false, error: 'phi', message: `PHI detected: ${e.kinds.join(', ')}` };
    }
    return { ok: false, error: 'unknown', message: 'Could not add the resource.' };
  }
}
