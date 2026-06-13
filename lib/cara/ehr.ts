/**
 * Cara EHR adapter (T5, tk-0005) — the default `EhrAdapter` impl (lib/providers/types.ts, FROZEN).
 *
 * Vendor-agnostic read/write via the Cara proxy: `elation | canvas | healthie`. The SAME code
 * talks to every vendor; only the proxy path differs (ehrPath). Swapping vendor = config.
 *
 * PHI care: `searchPatient` takes name/DOB (server-side only — this runs in a server action /
 * route, NEVER in model context) and returns OPAQUE `PatientRef`s. The caller resolves details
 * server-side. Nothing here logs the query or the chart payload.
 */

import type { EhrAdapter, EhrVendor, PatientRef, SendResult } from '@/lib/providers/types';
import { CaraClient, CaraRequestError, ehrPath, redactError } from './client';

/** Proxy response shape for a patient search (opaque ids only — we never trust it for PHI). */
interface ProxyPatientHit {
  externalId?: string;
  id?: string;
}
interface ProxySearchResponse {
  patients?: ProxyPatientHit[];
  results?: ProxyPatientHit[];
}

interface ProxyWriteResponse {
  id?: string;
  noteId?: string;
}

export class CaraEhrAdapter implements EhrAdapter {
  readonly vendor: EhrVendor;
  private readonly client: CaraClient;

  constructor(client: CaraClient, vendor: EhrVendor = 'elation') {
    this.client = client;
    this.vendor = vendor;
  }

  /**
   * POST a name/DOB search to the vendor proxy → opaque refs. The match happens server-side at
   * the proxy; we only ever hold/return the opaque externalId.
   */
  async searchPatient(query: { fullName: string; dateOfBirth: string }): Promise<PatientRef[]> {
    const data = await this.client.post<ProxySearchResponse>(ehrPath(this.vendor, 'patients/search'), {
      // Sent server→proxy over TLS; this body is never logged.
      fullName: query.fullName,
      dateOfBirth: query.dateOfBirth,
    });
    const hits = data.patients ?? data.results ?? [];
    return hits
      .map((h) => h.externalId ?? h.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((externalId) => ({ externalId }));
  }

  /** GET a chart by opaque ref. Returns the raw vendor record (server-side use only) or null. */
  async getPatient(ref: PatientRef): Promise<Record<string, unknown> | null> {
    try {
      const data = await this.client.get<Record<string, unknown> | null>(
        ehrPath(this.vendor, `patients/${encodeURIComponent(ref.externalId)}`),
      );
      return data ?? null;
    } catch (err) {
      if (err instanceof CaraRequestError && err.status === 404) return null;
      throw err;
    }
  }

  /** POST a triage note / disposition back to the chart. Returns a SendResult (never throws raw). */
  async writeNote(ref: PatientRef, note: { title: string; body: string }): Promise<SendResult> {
    try {
      const data = await this.client.post<ProxyWriteResponse>(
        ehrPath(this.vendor, `patients/${encodeURIComponent(ref.externalId)}/notes`),
        { title: note.title, body: note.body },
      );
      return { ok: true, providerMessageId: data.noteId ?? data.id };
    } catch (err) {
      return { ok: false, error: redactError(err) };
    }
  }
}
