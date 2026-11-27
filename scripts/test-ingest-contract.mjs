/**
 * Client contract for a temporary Overpass miss from upsert-discovered-courts.
 * Run: node --experimental-strip-types --test scripts/test-ingest-contract.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INGEST_COOLDOWN_MS,
  interpretSupabaseFunctionInvoke,
  onIngestBatchResult,
  readFunctionInvokePayload,
} from '../src/services/courtIngestContract.ts';
import { chunkIdentities, listOsmIdentitiesForIngest } from '../src/services/osmCourtIds.ts';

test('HTTP 503 with ok:false becomes a failed ingest result', async () => {
  const body = {
    ok: false,
    error: 'overpass_unavailable',
    inserted: 0,
    skipped: 0,
    rejected: 0,
    retry_ids: [{ type: 'way', id: 9 }],
  };
  const payload = await readFunctionInvokePayload(null, {
    message: 'Edge Function returned a non-2xx status code',
    context: {
      status: 503,
      json: async () => body,
      clone() {
        return this;
      },
    },
  });
  const result = interpretSupabaseFunctionInvoke({
    data: payload,
    error: {
      message: 'Edge Function returned a non-2xx status code',
      context: { status: 503 },
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, 'overpass_unavailable');
  }
});

test('HTTP 503 with ok:false becomes a failed ingest result when the body is already parsed', () => {
  const result = interpretSupabaseFunctionInvoke({
    data: {
      ok: false,
      error: 'overpass_unavailable',
      inserted: 0,
      skipped: 0,
      rejected: 0,
      retry_ids: [
        { type: 'way', id: 3 },
        { type: 'way', id: 4 },
      ],
    },
    error: {
      message: 'Edge Function returned a non-2xx status code',
      context: { status: 503 },
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, 'overpass_unavailable');
  }
});

test('a failed batch starts the 30s cooldown and the next search retries only missing ids', () => {
  const discovered = ['osm-way-1', 'osm-way-2', 'osm-way-3', 'osm-way-4', 'osm-way-5', 'osm-way-6'];
  const batches = chunkIdentities(listOsmIdentitiesForIngest(discovered), 2);
  const now = 1_700_000_000_000;
  let cooldownUntil = 0;
  const called = [];
  let dbIds = [];

  for (const batch of batches) {
    if (now < cooldownUntil) break;
    called.push(batch.map((identity) => identity.id));
    const failed = batch.some((identity) => identity.id === 3);
    if (!failed) {
      dbIds = dbIds.concat(batch.map((identity) => `osm-${identity.type}-${identity.id}`));
    }
    const step = onIngestBatchResult(now, !failed);
    if (!step.continueLoop) {
      cooldownUntil = step.cooldownUntil ?? now;
      break;
    }
  }

  assert.deepEqual(called, [
    [1, 2],
    [3, 4],
  ]);
  assert.equal(INGEST_COOLDOWN_MS, 30_000);
  assert.equal(cooldownUntil, now + INGEST_COOLDOWN_MS);
  assert.equal(now + 1_000 < cooldownUntil, true);
  assert.deepEqual(dbIds, ['osm-way-1', 'osm-way-2']);

  const retry = listOsmIdentitiesForIngest(discovered, dbIds);
  assert.deepEqual(retry, [
    { type: 'way', id: 3 },
    { type: 'way', id: 4 },
    { type: 'way', id: 5 },
    { type: 'way', id: 6 },
  ]);
});
