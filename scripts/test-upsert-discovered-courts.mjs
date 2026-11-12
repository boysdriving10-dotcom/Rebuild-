/**
 * Offline tests for upsert-discovered-courts ingest logic (no network / no Supabase).
 * Keep in sync with supabase/functions/upsert-discovered-courts/ingestLogic.ts
 * Run: node --test scripts/test-upsert-discovered-courts.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const MAX_OSM_IDS_PER_REQUEST = 40;
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_SECONDS = 600;

function parseOsmIdentities(input) {
  if (!Array.isArray(input)) return { identities: [], rejected: 0 };
  const seen = new Set();
  const identities = [];
  let rejected = 0;
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      rejected += 1;
      continue;
    }
    const type = typeof item.type === 'string' ? item.type.trim().toLowerCase() : '';
    const idNum =
      typeof item.id === 'number'
        ? item.id
        : typeof item.id === 'string' && /^\d+$/.test(item.id.trim())
          ? Number(item.id.trim())
          : NaN;
    if ((type !== 'node' && type !== 'way') || !Number.isInteger(idNum) || idNum <= 0) {
      rejected += 1;
      continue;
    }
    const key = `${type}/${idNum}`;
    if (seen.has(key)) continue;
    seen.add(key);
    identities.push({ type, id: idNum });
  }
  return { identities, rejected };
}

function enforceIdCap(identities) {
  if (identities.length <= MAX_OSM_IDS_PER_REQUEST) {
    return { accepted: identities, truncated: 0 };
  }
  return {
    accepted: identities.slice(0, MAX_OSM_IDS_PER_REQUEST),
    truncated: identities.length - MAX_OSM_IDS_PER_REQUEST,
  };
}

function hasBasketballEvidence(tags) {
  if (!tags || typeof tags !== 'object') return false;
  const sportTokens = (tags.sport ?? '')
    .toLowerCase()
    .split(/[;|,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return sportTokens.includes('basketball');
}

function coordsFromElement(el) {
  const latitude = el.lat ?? el.center?.lat;
  const longitude = el.lon ?? el.center?.lon;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

function courtRowFromOverpassElement(el) {
  const type = el.type === 'node' || el.type === 'way' ? el.type : null;
  const id = typeof el.id === 'number' && Number.isInteger(el.id) && el.id > 0 ? el.id : null;
  if (!type || id == null) return null;
  if (!hasBasketballEvidence(el.tags)) return null;
  const coords = coordsFromElement(el);
  if (!coords) return null;
  return {
    name: el.tags?.name?.trim() || 'Basketball Court',
    latitude: coords.latitude,
    longitude: coords.longitude,
    source: 'overpass',
    source_id: `${type}/${id}`,
    verification_status: 'verified',
  };
}

function decideUserAuth(user) {
  if (!user || typeof user.id !== 'string' || user.id.length === 0) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  if (user.role === 'anon' || user.id === 'anonymous') {
    return { ok: false, status: 401, error: 'anonymous_not_allowed' };
  }
  return { ok: true, userId: user.id };
}

function applyRateLimitWindow(state, nowMs, maxRequests = RATE_LIMIT_MAX_REQUESTS, windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000) {
  let windowStartedAtMs = state?.windowStartedAtMs ?? nowMs;
  let requestCount = state?.requestCount ?? 0;
  if (!state || windowStartedAtMs <= nowMs - windowMs) {
    windowStartedAtMs = nowMs;
    requestCount = 0;
  }
  if (requestCount >= maxRequests) {
    return {
      next: { windowStartedAtMs, requestCount },
      decision: { allowed: false, remaining: 0, request_count: requestCount, reason: 'rate_limited' },
    };
  }
  requestCount += 1;
  return {
    next: { windowStartedAtMs, requestCount },
    decision: {
      allowed: true,
      remaining: Math.max(maxRequests - requestCount, 0),
      request_count: requestCount,
    },
  };
}

function classifyOverpassFailure(kind) {
  return { ok: true, inserted: 0, skipped: 0, rejected: 'passthrough', soft: true, kind };
}

test('auth: rejects missing and anonymous users', () => {
  assert.deepEqual(decideUserAuth(null), { ok: false, status: 401, error: 'unauthorized' });
  assert.deepEqual(decideUserAuth({}), { ok: false, status: 401, error: 'unauthorized' });
  assert.deepEqual(decideUserAuth({ id: 'anonymous', role: 'anon' }), {
    ok: false,
    status: 401,
    error: 'anonymous_not_allowed',
  });
  assert.deepEqual(decideUserAuth({ id: '11111111-1111-1111-1111-111111111111' }), {
    ok: true,
    userId: '11111111-1111-1111-1111-111111111111',
  });
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

test('basketball tag validation requires sport evidence', () => {
  assert.equal(hasBasketballEvidence({ sport: 'basketball' }), true);
  assert.equal(hasBasketballEvidence({ sport: 'tennis;basketball' }), true);
  assert.equal(hasBasketballEvidence({ leisure: 'pitch', sport: 'basketball' }), true);
  assert.equal(hasBasketballEvidence({ sport: 'tennis' }), false);
  assert.equal(hasBasketballEvidence({ leisure: 'pitch' }), false);
  assert.equal(hasBasketballEvidence({}), false);
  assert.equal(hasBasketballEvidence(null), false);
});

test('invalid coordinates are rejected', () => {
  assert.equal(coordsFromElement({ lat: 91, lon: 0 }), null);
  assert.equal(coordsFromElement({ lat: 0, lon: 0 }), null);
  assert.equal(coordsFromElement({ lat: NaN, lon: -75 }), null);
  assert.equal(coordsFromElement({ center: { lat: 39.7, lon: -75.0 } })?.latitude, 39.7);
});

test('court rows require basketball evidence and valid coords', () => {
  assert.equal(
    courtRowFromOverpassElement({
      type: 'node',
      id: 1,
      lat: 39.7,
      lon: -75,
      tags: { sport: 'tennis' },
    }),
    null
  );
  assert.equal(
    courtRowFromOverpassElement({
      type: 'way',
      id: 2,
      center: { lat: 39.7, lon: -75 },
      tags: { sport: 'basketball', name: 'Park Court' },
    })?.source_id,
    'way/2'
  );
  assert.equal(
    courtRowFromOverpassElement({
      type: 'way',
      id: 2,
      center: { lat: 39.7, lon: -75 },
      tags: { sport: 'basketball', name: 'Park Court' },
    })?.verification_status,
    'verified'
  );
});

test('duplicate IDs in one request are collapsed before fetch', () => {
  const parsed = parseOsmIdentities([
    { type: 'node', id: 10 },
    { type: 'node', id: 10 },
    { type: 'node', id: 10 },
  ]);
  assert.equal(parsed.identities.length, 1);
  assert.equal(parsed.rejected, 0);
});

test('rate limiting allows 10 requests then blocks within 10 minutes', () => {
  let state = null;
  const start = 1_000_000;
  for (let i = 0; i < 10; i++) {
    const result = applyRateLimitWindow(state, start + i);
    assert.equal(result.decision.allowed, true);
    state = result.next;
  }
  const blocked = applyRateLimitWindow(state, start + 11);
  assert.equal(blocked.decision.allowed, false);
  assert.equal(blocked.decision.reason, 'rate_limited');

  const afterWindow = applyRateLimitWindow(blocked.next, start + RATE_LIMIT_WINDOW_SECONDS * 1000 + 1);
  assert.equal(afterWindow.decision.allowed, true);
  assert.equal(afterWindow.decision.request_count, 1);
});

test('failed Overpass responses are soft-fail friendly', () => {
  for (const kind of ['timeout', 'network', 'http_error', 'invalid_json']) {
    const result = classifyOverpassFailure(kind);
    assert.equal(result.ok, true);
    assert.equal(result.inserted, 0);
    assert.equal(result.soft, true);
    assert.equal(result.kind, kind);
  }
});

test('app-facing osm ids remain type/id based for games', () => {
  const row = courtRowFromOverpassElement({
    type: 'node',
    id: 123,
    lat: 40,
    lon: -74,
    tags: { sport: 'basketball' },
  });
  assert.equal(row.source, 'overpass');
  assert.equal(row.source_id, 'node/123');
  // Phase 1 mapper would turn this into osm-node-123
  assert.equal(`osm-${row.source_id.replace('/', '-')}`, 'osm-node-123');
});
