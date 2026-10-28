/**
 * Focused court-loading tests (no extra deps).
 * Run: node --test scripts/test-court-loading.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const FALLBACK_COURTS = [
  {
    id: 'fallback-owens-park',
    name: 'Owens Park Basketball Court',
    latitude: 39.678688,
    longitude: -75.01237,
  },
  {
    id: 'fallback-church-street-complex',
    name: 'Church Street Complex Basketball Courts',
    latitude: 39.68155,
    longitude: -74.996494,
  },
  {
    id: 'fallback-peter-volpa',
    name: 'Peter Volpa Memorial Park Basketball Courts',
    latitude: 39.725961,
    longitude: -74.977744,
  },
  {
    id: 'fallback-carmelo-felix',
    name: 'Carmelo Felix Memorial Park Basketball Court',
    latitude: 39.709194,
    longitude: -74.961387,
  },
];

function getFallbackCourtsInBBox(bbox) {
  return FALLBACK_COURTS.filter(
    (c) =>
      c.latitude >= bbox.south &&
      c.latitude <= bbox.north &&
      c.longitude >= bbox.west &&
      c.longitude <= bbox.east
  );
}

function shouldContinueAfterFailure({
  retryable,
  cancelled,
  attemptIndex,
  endpointCount,
}) {
  if (cancelled) return false;
  if (retryable) return true;
  return attemptIndex + 1 < endpointCount;
}

function dedupeCourts(courts) {
  const seen = new Set();
  const out = [];
  for (const court of courts) {
    if (seen.has(court.id)) continue;
    const coordKey = `${court.latitude.toFixed(5)},${court.longitude.toFixed(5)}`;
    if (seen.has(coordKey)) continue;
    seen.add(court.id);
    seen.add(coordKey);
    out.push(court);
  }
  return out;
}

function mergeCourtsWithFallback(existing, live, bbox) {
  const inBounds = (list) =>
    list.filter(
      (c) =>
        c.latitude >= bbox.south &&
        c.latitude <= bbox.north &&
        c.longitude >= bbox.west &&
        c.longitude <= bbox.east
    );
  return dedupeCourts([
    ...inBounds(live),
    ...inBounds(existing),
    ...getFallbackCourtsInBBox(bbox),
  ]);
}

test('fallback includes Volpa + Carmelo for Sicklerville viewport', () => {
  const bbox = {
    south: 39.705961,
    west: -74.997744,
    north: 39.745961,
    east: -74.957744,
  };
  const hits = getFallbackCourtsInBBox(bbox).map((c) => c.id);
  assert.ok(hits.includes('fallback-peter-volpa'));
  assert.ok(hits.includes('fallback-carmelo-felix'));
  assert.equal(hits.includes('fallback-owens-park'), false);
});

test('fallback empty outside NJ', () => {
  const bbox = {
    south: 40.65,
    west: -74.0,
    north: 40.71,
    east: -73.9,
  };
  assert.equal(getFallbackCourtsInBBox(bbox).length, 0);
});

test('406 on first endpoint continues to second; cancel does not', () => {
  assert.equal(
    shouldContinueAfterFailure({
      retryable: false,
      cancelled: false,
      attemptIndex: 0,
      endpointCount: 2,
    }),
    true
  );
  assert.equal(
    shouldContinueAfterFailure({
      retryable: false,
      cancelled: false,
      attemptIndex: 1,
      endpointCount: 2,
    }),
    false
  );
  assert.equal(
    shouldContinueAfterFailure({
      retryable: false,
      cancelled: true,
      attemptIndex: 0,
      endpointCount: 2,
    }),
    false
  );
});

test('retryable failures continue within attempt budget', () => {
  assert.equal(
    shouldContinueAfterFailure({
      retryable: true,
      cancelled: false,
      attemptIndex: 0,
      endpointCount: 2,
    }),
    true
  );
});

test('merge keeps fallback when live Overpass is empty', () => {
  const bbox = {
    south: 39.705961,
    west: -74.997744,
    north: 39.745961,
    east: -74.957744,
  };
  const merged = mergeCourtsWithFallback([], [], bbox);
  assert.ok(merged.some((c) => c.id === 'fallback-peter-volpa'));
  assert.ok(merged.some((c) => c.id === 'fallback-carmelo-felix'));
});

test('merge dedupes live court that shares coords with fallback', () => {
  const bbox = {
    south: 39.67,
    west: -75.02,
    north: 39.69,
    east: -74.99,
  };
  const live = [
    {
      id: 'osm-way-667347315',
      name: 'Basketball Court',
      latitude: 39.678688,
      longitude: -75.01237,
    },
  ];
  const merged = mergeCourtsWithFallback([], live, bbox);
  const owens = merged.filter(
    (c) =>
      Math.abs(c.latitude - 39.678688) < 1e-6 &&
      Math.abs(c.longitude - -75.01237) < 1e-6
  );
  assert.equal(owens.length, 1);
  assert.equal(owens[0].id, 'osm-way-667347315');
});

test('simulated fetch sequence: first 406 then 200 uses second host', async () => {
  const endpoints = ['overpass', 'lz4'];
  const responses = {
    overpass: { ok: false, status: 406, retryable: false },
    lz4: {
      ok: true,
      courts: [{ id: 'osm-1', latitude: 40.7, longitude: -74.0 }],
    },
  };
  const attempts = [];
  let result = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    const host = endpoints[attempt % endpoints.length];
    attempts.push(host);
    const r = responses[host];
    if (r.ok) {
      result = r;
      break;
    }
    if (
      !shouldContinueAfterFailure({
        retryable: r.retryable,
        cancelled: false,
        attemptIndex: attempt,
        endpointCount: endpoints.length,
      })
    ) {
      break;
    }
  }
  assert.deepEqual(attempts, ['overpass', 'lz4']);
  assert.equal(result?.ok, true);
  assert.equal(result.courts.length, 1);
});

test('simulated cancel stops before second host', () => {
  const endpoints = ['overpass', 'lz4'];
  const attempts = [];
  for (let attempt = 0; attempt <= 2; attempt++) {
    const host = endpoints[attempt % endpoints.length];
    attempts.push(host);
    const cancelled = attempt === 0;
    if (cancelled) break;
    if (
      !shouldContinueAfterFailure({
        retryable: false,
        cancelled: false,
        attemptIndex: attempt,
        endpointCount: endpoints.length,
      })
    ) {
      break;
    }
  }
  assert.deepEqual(attempts, ['overpass']);
});

function formatCourtLoadDiag({ host, category, status }) {
  if (category === 'http' && status != null) return `HTTP ${status}@${host}`;
  if (category === 'timeout') return `timeout@${host}`;
  if (category === 'network') return `network@${host}`;
  if (category === 'invalid_json') return `invalid_json@${host}`;
  return `empty@${host}`;
}

function withCourtLoadDiag(message, diag) {
  if (!diag) return message;
  return `${message} [${diag}]`;
}

function overpassHostLabel(endpoint) {
  return endpoint.includes('lz4.') ? 'lz4' : 'overpass';
}

test('diag tags cover http/timeout/network/invalid_json/empty without secrets', () => {
  assert.equal(
    formatCourtLoadDiag({ host: 'lz4', category: 'http', status: 406 }),
    'HTTP 406@lz4'
  );
  assert.equal(
    formatCourtLoadDiag({ host: 'overpass', category: 'timeout' }),
    'timeout@overpass'
  );
  assert.equal(
    formatCourtLoadDiag({ host: 'overpass', category: 'network' }),
    'network@overpass'
  );
  assert.equal(
    formatCourtLoadDiag({ host: 'lz4', category: 'invalid_json' }),
    'invalid_json@lz4'
  );
  assert.equal(
    formatCourtLoadDiag({ host: 'overpass', category: 'empty' }),
    'empty@overpass'
  );
  const tagged = withCourtLoadDiag(
    'Could not load courts. Check your connection and try again.',
    'HTTP 406@lz4'
  );
  assert.equal(
    tagged,
    'Could not load courts. Check your connection and try again. [HTTP 406@lz4]'
  );
  assert.equal(withCourtLoadDiag('msg', null), 'msg');
  assert.equal(withCourtLoadDiag('msg', undefined), 'msg');
});

test('host label never exposes full URL path', () => {
  assert.equal(
    overpassHostLabel('https://overpass-api.de/api/interpreter'),
    'overpass'
  );
  assert.equal(
    overpassHostLabel('https://lz4.overpass-api.de/api/interpreter'),
    'lz4'
  );
});

test('Retry-only display: non-force keeps plain error; force appends diag', () => {
  const base = 'Court service is busy. Tap retry or pan the map to try again.';
  const diag = 'HTTP 503@overpass';
  // Mirror useMapCourts: append diag only when showDiag (force) is true.
  const display = (force) =>
    force ? withCourtLoadDiag(base, diag) : base;
  assert.equal(display(false), base);
  assert.equal(display(true), `${base} [${diag}]`);
  assert.match(display(true), /\[HTTP 503@overpass\]$/);
});

test('empty HTTP 200 diag distinct from network failure diag', () => {
  const empty = formatCourtLoadDiag({ host: 'overpass', category: 'empty' });
  const network = formatCourtLoadDiag({ host: 'overpass', category: 'network' });
  assert.notEqual(empty, network);
  assert.equal(
    withCourtLoadDiag('No courts found nearby', empty),
    'No courts found nearby [empty@overpass]'
  );
});
