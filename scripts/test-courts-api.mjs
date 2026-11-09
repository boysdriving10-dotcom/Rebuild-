/**
 * Pure-helper tests for the courts DB data-access layer (no network).
 * Run: node --test scripts/test-courts-api.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const COURTS_QUERY_LIMIT_MAX = 500;

function isValidCourtBBox(bbox) {
  const { south, west, north, east } = bbox;
  if (![south, west, north, east].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return false;
  }
  if (south > north || west > east) return false;
  if (south < -90 || north > 90) return false;
  if (west < -180 || east > 180) return false;
  return true;
}

function clampCourtsQueryLimit(limit) {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return COURTS_QUERY_LIMIT_MAX;
  }
  return Math.min(Math.floor(limit), COURTS_QUERY_LIMIT_MAX);
}

function mapCourtRowToCourt(row) {
  return {
    id: row.id,
    name: row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    address: row.address?.trim() || 'Address unavailable',
    activeGameIds: [],
  };
}

/**
 * Mirrors fetchCourtsInBounds filters + defaults:
 * verifiedOnly defaults to true; limit is clamped to 1..500.
 */
function filterCourtsInBounds(rows, bbox, options = {}) {
  const verifiedOnly = options.verifiedOnly ?? true;
  const limit = clampCourtsQueryLimit(options.limit);
  const hits = rows.filter((row) => {
    if (verifiedOnly && row.verification_status !== 'verified') return false;
    return (
      row.latitude >= bbox.south &&
      row.latitude <= bbox.north &&
      row.longitude >= bbox.west &&
      row.longitude <= bbox.east
    );
  });
  return hits.slice(0, limit);
}

/** Mirrors the public SELECT RLS policy: verified rows only. */
function publicRlsVisible(rows) {
  return rows.filter((row) => row.verification_status === 'verified');
}

function isNonBlankCourtText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const SAMPLE_ROWS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Owens Park Basketball Court',
    latitude: 39.678688,
    longitude: -75.01237,
    address: '690 N Tuckahoe Rd, Williamstown, NJ 08094',
    city: 'Williamstown',
    region: 'NJ',
    country: 'US',
    source: 'fallback',
    source_id: 'owens-park',
    verification_status: 'verified',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Peter Volpa Memorial Park Basketball Courts',
    latitude: 39.725961,
    longitude: -74.977744,
    address: '569 Sickler Ave, Sicklerville, NJ 08081',
    city: 'Sicklerville',
    region: 'NJ',
    country: 'US',
    source: 'fallback',
    source_id: 'peter-volpa',
    verification_status: 'verified',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Unverified draft court',
    latitude: 39.73,
    longitude: -74.98,
    address: null,
    city: null,
    region: null,
    country: null,
    source: 'manual',
    source_id: 'draft-1',
    verification_status: 'unverified',
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    name: 'Rejected court',
    latitude: 39.72,
    longitude: -74.97,
    address: 'Rejected Ave',
    city: 'Sicklerville',
    region: 'NJ',
    country: 'US',
    source: 'manual',
    source_id: 'rejected-1',
    verification_status: 'rejected',
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    name: 'Outside bbox',
    latitude: 40.0,
    longitude: -75.0,
    address: 'Elsewhere',
    city: 'Philadelphia',
    region: 'PA',
    country: 'US',
    source: 'manual',
    source_id: 'outside',
    verification_status: 'verified',
  },
];

const SICKLERVILLE_BBOX = {
  south: 39.705961,
  west: -74.997744,
  north: 39.745961,
  east: -74.957744,
};

test('isValidCourtBBox accepts a normal map viewport', () => {
  assert.equal(
    isValidCourtBBox({
      south: 39.7,
      west: -75.02,
      north: 39.74,
      east: -74.96,
    }),
    true
  );
});

test('isValidCourtBBox rejects inverted or non-finite bounds', () => {
  assert.equal(
    isValidCourtBBox({ south: 39.8, west: -75, north: 39.7, east: -74.9 }),
    false
  );
  assert.equal(
    isValidCourtBBox({ south: 39.7, west: -74.9, north: 39.8, east: -75 }),
    false
  );
  assert.equal(
    isValidCourtBBox({ south: NaN, west: -75, north: 39.8, east: -74.9 }),
    false
  );
});

test('mapCourtRowToCourt matches the existing Court model', () => {
  const court = mapCourtRowToCourt(SAMPLE_ROWS[0]);
  assert.deepEqual(court, {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Owens Park Basketball Court',
    latitude: 39.678688,
    longitude: -75.01237,
    address: '690 N Tuckahoe Rd, Williamstown, NJ 08094',
    activeGameIds: [],
  });
});

test('mapCourtRowToCourt fills missing address', () => {
  const court = mapCourtRowToCourt(SAMPLE_ROWS[2]);
  assert.equal(court.address, 'Address unavailable');
  assert.deepEqual(court.activeGameIds, []);
});

test('default verifiedOnly excludes unverified and rejected rows in bbox', () => {
  const hits = filterCourtsInBounds(SAMPLE_ROWS, SICKLERVILLE_BBOX).map((r) => r.source_id);
  assert.deepEqual(hits, ['peter-volpa']);
});

test('verifiedOnly false still returns unverified and rejected inside bbox', () => {
  const hits = filterCourtsInBounds(SAMPLE_ROWS, SICKLERVILLE_BBOX, {
    verifiedOnly: false,
  }).map((r) => r.source_id);
  assert.deepEqual(hits.sort(), ['draft-1', 'peter-volpa', 'rejected-1']);
});

test('public RLS visibility exposes only verified courts', () => {
  const visible = publicRlsVisible(SAMPLE_ROWS).map((r) => r.source_id).sort();
  assert.deepEqual(visible, ['outside', 'owens-park', 'peter-volpa']);
});

test('blank name/source/source_id fail non-blank checks', () => {
  assert.equal(isNonBlankCourtText(''), false);
  assert.equal(isNonBlankCourtText('   '), false);
  assert.equal(isNonBlankCourtText('Owens Park'), true);
  assert.equal(isNonBlankCourtText('fallback'), true);
  assert.equal(isNonBlankCourtText('owens-park'), true);
});

test('clampCourtsQueryLimit caps at 500 and replaces invalid values', () => {
  assert.equal(clampCourtsQueryLimit(undefined), 500);
  assert.equal(clampCourtsQueryLimit(NaN), 500);
  assert.equal(clampCourtsQueryLimit(0), 500);
  assert.equal(clampCourtsQueryLimit(-10), 500);
  assert.equal(clampCourtsQueryLimit(12.9), 12);
  assert.equal(clampCourtsQueryLimit(500), 500);
  assert.equal(clampCourtsQueryLimit(501), 500);
  assert.equal(clampCourtsQueryLimit(10000), 500);
});

test('bbox filter respects the clamped limit', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    id: `id-${i}`,
    name: `Court ${i}`,
    latitude: 39.72,
    longitude: -74.97,
    address: null,
    source: 'manual',
    source_id: `c-${i}`,
    verification_status: 'verified',
  }));
  const hits = filterCourtsInBounds(many, SICKLERVILLE_BBOX, { limit: 3 });
  assert.equal(hits.length, 3);
  const capped = filterCourtsInBounds(many, SICKLERVILLE_BBOX, { limit: 9999 });
  assert.equal(capped.length, 10);
});
