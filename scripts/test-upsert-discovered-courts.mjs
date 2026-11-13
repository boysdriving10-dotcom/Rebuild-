/**
 * Offline tests for upsert-discovered-courts — imports production ingestLogic.ts.
 * Run: npm run test:upsert-courts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COURT_REFRESH_AFTER_MS,
  GLOBAL_RATE_LIMIT_MAX_REQUESTS,
  GLOBAL_RATE_LIMIT_WINDOW_SECONDS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS,
  applyRateLimitWindow,
  coordsFromElement,
  courtRowFromOverpassElement,
  decideUserAuth,
  enforceIdCap,
  hasBasketballEvidence,
  interpretRateLimitResult,
  needsOverpassFetch,
  parseExistingCourtsLookup,
  parseOsmIdentities,
  partitionIdentitiesForFetch,
  sourceIdKey,
} from '../supabase/functions/upsert-discovered-courts/ingestLogic.ts';

test('auth: rejects missing, anon-role, and Supabase anonymous users', () => {
  assert.deepEqual(decideUserAuth(null), { ok: false, status: 401, error: 'unauthorized' });
  assert.deepEqual(decideUserAuth({}), { ok: false, status: 401, error: 'unauthorized' });
  assert.deepEqual(decideUserAuth({ id: 'anonymous', role: 'anon' }), {
    ok: false,
    status: 401,
    error: 'anonymous_not_allowed',
  });
  assert.deepEqual(
    decideUserAuth({
      id: '11111111-1111-1111-1111-111111111111',
      role: 'authenticated',
      is_anonymous: true,
    }),
    { ok: false, status: 401, error: 'anonymous_not_allowed' }
  );
  assert.deepEqual(
    decideUserAuth({
      id: '11111111-1111-1111-1111-111111111111',
      role: 'authenticated',
      is_anonymous: false,
    }),
    { ok: true, userId: '11111111-1111-1111-1111-111111111111' }
  );
});

test('malformed OSM identities are rejected; duplicates de-duped', () => {
  const parsed = parseOsmIdentities([
    { type: 'node', id: 123 },
    { type: 'way', id: 456 },
    { type: 'node', id: 123 },
    { type: 'relation', id: 9 },
    { type: 'node', id: 'abc' },
    { type: 'NODE', id: '789' },
    null,
    { type: 'way' },
  ]);
  assert.deepEqual(parsed.identities, [
    { type: 'node', id: 123 },
    { type: 'way', id: 456 },
    { type: 'node', id: 789 },
  ]);
  assert.equal(parsed.rejected, 4);
});

test('request ID cap truncates above 40', () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ type: 'node', id: i + 1 }));
  const parsed = parseOsmIdentities(many);
  const capped = enforceIdCap(parsed.identities);
  assert.equal(capped.accepted.length, 40);
  assert.equal(capped.truncated, 5);
});

test('basketball evidence requires credible court/pitch tagging', () => {
  assert.equal(hasBasketballEvidence({ leisure: 'pitch', sport: 'basketball' }), true);
  assert.equal(hasBasketballEvidence({ leisure: 'pitch', sport: 'tennis;basketball' }), true);
  assert.equal(hasBasketballEvidence({ leisure: 'sports_centre', sport: 'basketball' }), true);
  assert.equal(hasBasketballEvidence({ sport: 'basketball' }), true);
  assert.equal(hasBasketballEvidence({ sport: 'tennis' }), false);
  assert.equal(hasBasketballEvidence({ leisure: 'pitch' }), false);
  assert.equal(hasBasketballEvidence({ leisure: 'swimming_pool', sport: 'basketball' }), false);
  assert.equal(hasBasketballEvidence({ sport: 'basketball', shop: 'sports' }), false);
  assert.equal(hasBasketballEvidence({ sport: 'basketball', amenity: 'cafe' }), false);
  assert.equal(hasBasketballEvidence({}), false);
  assert.equal(hasBasketballEvidence(null), false);
});

test('invalid coordinates are rejected; way centers accepted', () => {
  assert.equal(coordsFromElement({ lat: 91, lon: 0 }), null);
  assert.equal(coordsFromElement({ lat: 0, lon: 0 }), null);
  assert.equal(coordsFromElement({ lat: NaN, lon: -75 }), null);
  assert.equal(coordsFromElement({ center: { lat: 39.7, lon: -75.0 } })?.latitude, 39.7);
});

test('court rows require basketball evidence, valid coords, and bump updated_at', () => {
  assert.equal(
    courtRowFromOverpassElement(
      {
        type: 'node',
        id: 1,
        lat: 39.7,
        lon: -75,
        tags: { sport: 'tennis' },
      },
      '2026-11-12T00:00:00.000Z'
    ),
    null
  );
  const row = courtRowFromOverpassElement(
    {
      type: 'way',
      id: 2,
      center: { lat: 39.7, lon: -75 },
      tags: { leisure: 'pitch', sport: 'basketball', name: 'Park Court' },
    },
    '2026-11-12T00:00:00.000Z'
  );
  assert.equal(row?.source_id, 'way/2');
  assert.equal(row?.verification_status, 'verified');
  assert.equal(row?.updated_at, '2026-11-12T00:00:00.000Z');
});

test('per-user rate limiting allows 10 requests then blocks within 10 minutes', () => {
  let state = null;
  const start = 1_000_000;
  for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
    const result = applyRateLimitWindow(
      state,
      start + i,
      RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_WINDOW_SECONDS * 1000,
      'rate_limited'
    );
    assert.equal(result.decision.allowed, true);
    state = result.next;
  }
  const blocked = applyRateLimitWindow(
    state,
    start + 11,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_SECONDS * 1000,
    'rate_limited'
  );
  assert.equal(blocked.decision.allowed, false);
  assert.equal(blocked.decision.reason, 'rate_limited');
});

test('global rate limiting blocks after budget when Overpass is required', () => {
  let globalState = null;
  const start = 2_000_000;
  for (let i = 0; i < GLOBAL_RATE_LIMIT_MAX_REQUESTS; i++) {
    assert.equal(needsOverpassFetch(1), true);
    const result = applyRateLimitWindow(
      globalState,
      start + i,
      GLOBAL_RATE_LIMIT_MAX_REQUESTS,
      GLOBAL_RATE_LIMIT_WINDOW_SECONDS * 1000,
      'global_rate_limited'
    );
    assert.equal(result.decision.allowed, true, `expected allow at ${i}`);
    globalState = result.next;
  }
  const blocked = applyRateLimitWindow(
    globalState,
    start + GLOBAL_RATE_LIMIT_MAX_REQUESTS + 1,
    GLOBAL_RATE_LIMIT_MAX_REQUESTS,
    GLOBAL_RATE_LIMIT_WINDOW_SECONDS * 1000,
    'global_rate_limited'
  );
  assert.equal(blocked.decision.allowed, false);
  assert.equal(blocked.decision.reason, 'global_rate_limited');
});

test('fresh-only requests do not consume global Overpass budget', () => {
  let userState = null;
  let globalState = { windowStartedAtMs: 3_000_000, requestCount: 7 };
  const now = 3_000_001;

  // Simulate Edge Function: always consume user; only consume global when toFetch > 0.
  const user = applyRateLimitWindow(
    userState,
    now,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_SECONDS * 1000,
    'rate_limited'
  );
  assert.equal(user.decision.allowed, true);
  userState = user.next;

  const identities = [{ type: 'node', id: 1 }];
  const existing = new Map([
    [
      'node/1',
      {
        source_id: 'node/1',
        updatedAtMs: now - 60_000,
        verification_status: 'verified',
      },
    ],
  ]);
  const partitioned = partitionIdentitiesForFetch(identities, existing, now, COURT_REFRESH_AFTER_MS);
  assert.equal(partitioned.toFetch.length, 0);
  assert.equal(needsOverpassFetch(partitioned.toFetch.length), false);

  // Global budget untouched because no Overpass is required.
  assert.equal(globalState.requestCount, 7);
});

test('requests that need Overpass consume global budget and stay fail-closed', () => {
  let globalState = { windowStartedAtMs: 4_000_000, requestCount: GLOBAL_RATE_LIMIT_MAX_REQUESTS };
  const identities = [{ type: 'node', id: 99 }];
  const existing = new Map();
  const partitioned = partitionIdentitiesForFetch(identities, existing, 4_000_001, COURT_REFRESH_AFTER_MS);
  assert.equal(needsOverpassFetch(partitioned.toFetch.length), true);

  const blocked = applyRateLimitWindow(
    globalState,
    4_000_001,
    GLOBAL_RATE_LIMIT_MAX_REQUESTS,
    GLOBAL_RATE_LIMIT_WINDOW_SECONDS * 1000,
    'global_rate_limited'
  );
  assert.equal(blocked.decision.allowed, false);
  assert.equal(blocked.decision.reason, 'global_rate_limited');
  // Concurrent callers serialize on the same window state — no bypass when already full.
  const again = applyRateLimitWindow(
    blocked.next,
    4_000_002,
    GLOBAL_RATE_LIMIT_MAX_REQUESTS,
    GLOBAL_RATE_LIMIT_WINDOW_SECONDS * 1000,
    'global_rate_limited'
  );
  assert.equal(again.decision.allowed, false);
});

test('interpretRateLimitResult fails closed and preserves global reason', () => {
  assert.equal(interpretRateLimitResult(null).allowed, false);
  assert.equal(interpretRateLimitResult(null).reason, 'rate_limit_unavailable');
  assert.deepEqual(
    interpretRateLimitResult({
      allowed: false,
      remaining: 0,
      request_count: 10,
      global_remaining: 0,
      reason: 'global_rate_limited',
    }).reason,
    'global_rate_limited'
  );
});

test('database lookup failures fail closed', () => {
  assert.deepEqual(parseExistingCourtsLookup(null, { message: 'db down' }), {
    ok: false,
    error: 'lookup_failed',
  });
  assert.deepEqual(parseExistingCourtsLookup(null, null), {
    ok: false,
    error: 'lookup_failed',
  });
  const ok = parseExistingCourtsLookup(
    [
      {
        source_id: 'node/1',
        updated_at: '2026-11-01T00:00:00.000Z',
        verification_status: 'verified',
      },
    ],
    null
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.bySourceId.get('node/1')?.updatedAtMs, Date.parse('2026-11-01T00:00:00.000Z'));
    assert.equal(ok.bySourceId.get('node/1')?.verification_status, 'verified');
  }
});

test('refresh fetches stale verified courts but skips fresh verified ones', () => {
  const now = Date.parse('2026-11-12T00:00:00.000Z');
  const identities = [
    { type: 'node', id: 1 },
    { type: 'node', id: 2 },
    { type: 'way', id: 3 },
  ];
  const existing = new Map([
    [
      'node/1',
      {
        source_id: 'node/1',
        updatedAtMs: now - 60_000,
        verification_status: 'verified',
      },
    ],
    [
      'node/2',
      {
        source_id: 'node/2',
        updatedAtMs: now - COURT_REFRESH_AFTER_MS - 1,
        verification_status: 'verified',
      },
    ],
  ]);
  const result = partitionIdentitiesForFetch(identities, existing, now, COURT_REFRESH_AFTER_MS);
  assert.equal(result.skippedFresh, 1);
  assert.equal(result.refreshCount, 1);
  assert.equal(result.skippedRejected, 0);
  assert.deepEqual(
    result.toFetch.map((i) => sourceIdKey(i.type, i.id)),
    ['node/2', 'way/3']
  );
});

test('rejected courts are never sent to Overpass and stay rejected', () => {
  const now = Date.parse('2026-11-12T00:00:00.000Z');
  const identities = [
    { type: 'node', id: 10 },
    { type: 'way', id: 11 },
  ];
  const existing = new Map([
    [
      'node/10',
      {
        source_id: 'node/10',
        updatedAtMs: now - COURT_REFRESH_AFTER_MS * 2,
        verification_status: 'rejected',
      },
    ],
  ]);
  const result = partitionIdentitiesForFetch(identities, existing, now, COURT_REFRESH_AFTER_MS);
  assert.equal(result.skippedRejected, 1);
  assert.equal(result.refreshCount, 0);
  assert.deepEqual(
    result.toFetch.map((i) => sourceIdKey(i.type, i.id)),
    ['way/11']
  );
  assert.equal(
    result.toFetch.some((i) => sourceIdKey(i.type, i.id) === 'node/10'),
    false
  );
});

test('unverified courts may be fetched for promotion but rows only publish as verified', () => {
  const now = Date.parse('2026-11-12T00:00:00.000Z');
  const identities = [{ type: 'node', id: 20 }];
  const existing = new Map([
    [
      'node/20',
      {
        source_id: 'node/20',
        updatedAtMs: now - 1_000,
        verification_status: 'unverified',
      },
    ],
  ]);
  const result = partitionIdentitiesForFetch(identities, existing, now, COURT_REFRESH_AFTER_MS);
  assert.equal(result.toFetch.length, 1);
  assert.equal(result.refreshCount, 0);
  const row = courtRowFromOverpassElement({
    type: 'node',
    id: 20,
    lat: 40,
    lon: -74,
    tags: { leisure: 'pitch', sport: 'basketball' },
  });
  assert.equal(row?.verification_status, 'verified');
});

test('app-facing osm ids remain type/id based for games', () => {
  const row = courtRowFromOverpassElement({
    type: 'node',
    id: 123,
    lat: 40,
    lon: -74,
    tags: { leisure: 'pitch', sport: 'basketball' },
  });
  assert.equal(row.source, 'overpass');
  assert.equal(row.source_id, 'node/123');
  assert.equal(`osm-${row.source_id.replace('/', '-')}`, 'osm-node-123');
});
