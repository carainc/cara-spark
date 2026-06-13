/**
 * EHR proxy tests (T5) — vendor-agnostic read/write against MOCKED Canvas AND Elation.
 * Asserts: correct proxy path per vendor, GET/POST methods, auth headers present, opaque-ref-only
 * outputs, 404 → null, and write errors returned (not thrown).
 */
import { describe, it, expect } from 'vitest';
import { CaraClient } from '@/lib/cara/client';
import { CaraEhrAdapter } from '@/lib/cara/ehr';
import { makeMockFetch, testConfig, TEST_API_KEY, TEST_TENANT_ID } from './_mock-fetch';

describe('CaraEhrAdapter — vendor-agnostic via the Cara proxy', () => {
  for (const vendor of ['elation', 'canvas'] as const) {
    describe(`vendor=${vendor}`, () => {
      it('searchPatient POSTs to the vendor search path and returns opaque refs only', async () => {
        const mock = makeMockFetch([
          { match: `/ehr/${vendor}/patients/search`, json: { patients: [{ externalId: 'ext-1' }, { id: 'ext-2' }] } },
        ]);
        const ehr = new CaraEhrAdapter(new CaraClient(testConfig(mock.fetchImpl)), vendor);

        const refs = await ehr.searchPatient({ fullName: 'Jordan Rivers', dateOfBirth: '1990-01-02' });

        expect(refs).toEqual([{ externalId: 'ext-1' }, { externalId: 'ext-2' }]);
        const req = mock.requests[0];
        expect(req.method).toBe('POST');
        expect(req.url).toContain(`/ehr/${vendor}/patients/search`);
        // Auth headers ride every request.
        expect(req.headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
        expect(req.headers['X-Tenant-ID']).toBe(TEST_TENANT_ID);
      });

      it('getPatient GETs the vendor patient path and returns the record', async () => {
        const mock = makeMockFetch([
          { match: `/ehr/${vendor}/patients/ext-1`, json: { externalId: 'ext-1', status: 'active' } },
        ]);
        const ehr = new CaraEhrAdapter(new CaraClient(testConfig(mock.fetchImpl)), vendor);

        const rec = await ehr.getPatient({ externalId: 'ext-1' });

        expect(rec).toMatchObject({ externalId: 'ext-1' });
        expect(mock.requests[0].method).toBe('GET');
        expect(mock.requests[0].url).toContain(`/ehr/${vendor}/patients/ext-1`);
      });

      it('getPatient returns null on 404', async () => {
        const mock = makeMockFetch([{ match: `/ehr/${vendor}/patients/missing`, status: 404, text: 'not found' }]);
        const ehr = new CaraEhrAdapter(new CaraClient(testConfig(mock.fetchImpl)), vendor);

        expect(await ehr.getPatient({ externalId: 'missing' })).toBeNull();
      });

      it('writeNote POSTs to the notes path and returns ok', async () => {
        const mock = makeMockFetch([
          { match: `/ehr/${vendor}/patients/ext-1/notes`, json: { noteId: 'note-9' } },
        ]);
        const ehr = new CaraEhrAdapter(new CaraClient(testConfig(mock.fetchImpl)), vendor);

        const res = await ehr.writeNote({ externalId: 'ext-1' }, { title: 'Triage', body: 'Disposition recorded.' });

        expect(res).toEqual({ ok: true, providerMessageId: 'note-9' });
        expect(mock.requests[0].method).toBe('POST');
        expect(mock.requests[0].url).toContain(`/ehr/${vendor}/patients/ext-1/notes`);
      });

      it('writeNote returns a redaction-safe error (does not throw) on proxy failure', async () => {
        const mock = makeMockFetch([{ match: `/ehr/${vendor}/patients/ext-1/notes`, status: 500, text: 'boom' }]);
        const ehr = new CaraEhrAdapter(new CaraClient(testConfig(mock.fetchImpl)), vendor);

        const res = await ehr.writeNote({ externalId: 'ext-1' }, { title: 'Triage', body: 'x' });

        expect(res.ok).toBe(false);
        expect(res.error).toBeTypeOf('string');
        // The key must never appear in a surfaced error.
        expect(res.error).not.toContain(TEST_API_KEY);
      });
    });
  }

  it('routes the SAME call to different paths purely by vendor (swap = config)', async () => {
    const elationMock = makeMockFetch([{ match: '/ehr/elation/patients/search', json: { patients: [] } }]);
    const canvasMock = makeMockFetch([{ match: '/ehr/canvas/patients/search', json: { patients: [] } }]);

    await new CaraEhrAdapter(new CaraClient(testConfig(elationMock.fetchImpl)), 'elation').searchPatient({
      fullName: 'A B',
      dateOfBirth: '2000-01-01',
    });
    await new CaraEhrAdapter(new CaraClient(testConfig(canvasMock.fetchImpl)), 'canvas').searchPatient({
      fullName: 'A B',
      dateOfBirth: '2000-01-01',
    });

    expect(elationMock.requests[0].url).toContain('/ehr/elation/');
    expect(canvasMock.requests[0].url).toContain('/ehr/canvas/');
  });
});
