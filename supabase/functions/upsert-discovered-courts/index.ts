/**
 * upsert-discovered-courts
 *
 * Authenticated (non-anonymous) users may submit OSM node/way IDs only. This
 * function re-fetches those elements from Overpass, validates basketball court
 * evidence + coordinates, then upserts verified rows with the service role.
 *
 * Never deploy secrets to the mobile app. Do not trust client lat/name.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

import {
  GLOBAL_RATE_LIMIT_MAX_REQUESTS,
  GLOBAL_RATE_LIMIT_WINDOW_SECONDS,
  OVERPASS_TIMEOUT_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS,
  OVERPASS_UNAVAILABLE_ERROR,
  buildOverpassIdsQuery,
  classifyIngestElements,
  decideUserAuth,
  enforceIdCap,
  interpretRateLimitResult,
  needsOverpassFetch,
  parseExistingCourtsLookup,
  parseOsmIdentities,
  partitionIdentitiesForFetch,
  publicOverpassAttempt,
  sourceIdKey,
  retryIdentities,
  runOverpassMirrorSequence,
  type CourtUpsertRow,
  type MirrorProbe,
  type OsmIdentity,
  type OverpassElement,
} from './ingestLogic.ts';

// Same independent mirrors as the client. overpass-api.de alone often exceeds
// OVERPASS_TIMEOUT_MS, which dropped the re-fetch after discovery succeeded.
const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
] as const;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return json({}, 204);
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ ok: false, error: 'function_not_configured' }, 503);
    }

    const authHeader = request.headers.get('Authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    const auth = decideUserAuth(userData.user);
    if (!auth.ok) {
      return json({ ok: false, error: auth.error }, auth.status);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Per-user limit always applies (including fresh-only requests).
    const userRateRpc = await serviceClient.rpc('consume_court_ingest_user_rate_limit', {
      p_user_id: auth.userId,
      p_max_requests: RATE_LIMIT_MAX_REQUESTS,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    });
    if (userRateRpc.error) {
      return json(
        {
          ok: false,
          error: 'rate_limit_unavailable',
          inserted: 0,
          skipped: 0,
          rejected: 0,
        },
        503
      );
    }
    const userRate = interpretRateLimitResult(userRateRpc.data);
    if (!userRate.allowed) {
      return json(
        {
          ok: false,
          error: 'rate_limited',
          inserted: 0,
          skipped: 0,
          rejected: 0,
          remaining: userRate.remaining,
        },
        429
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'invalid_json', inserted: 0, skipped: 0, rejected: 0 }, 400);
    }

    const rawElements =
      body && typeof body === 'object' && Array.isArray((body as { elements?: unknown }).elements)
        ? (body as { elements: unknown }).elements
        : body;

    const parsed = parseOsmIdentities(rawElements);
    const capped = enforceIdCap(parsed.identities);
    let rejected = parsed.rejected + capped.truncated;
    let skipped = 0;
    let inserted = 0;
    let refreshed = 0;

    const identities = capped.accepted;
    if (identities.length === 0) {
      return json({
        ok: true,
        inserted: 0,
        skipped: 0,
        rejected,
        refreshed: 0,
        remaining: userRate.remaining,
      });
    }

    const existingLookup = await loadExistingCourts(serviceClient, identities);
    if (!existingLookup.ok) {
      return json(
        {
          ok: false,
          error: 'courts_lookup_failed',
          inserted: 0,
          skipped: 0,
          rejected: 0,
          remaining: userRate.remaining,
        },
        503
      );
    }

    const partitioned = partitionIdentitiesForFetch(
      identities,
      existingLookup.bySourceId,
      Date.now()
    );
    skipped += partitioned.skippedFresh + partitioned.skippedRejected;
    const toFetch = partitioned.toFetch;

    if (!needsOverpassFetch(toFetch.length)) {
      // Fresh-only / rejected-only: no Overpass, so do not consume global budget.
      return json({
        ok: true,
        inserted: 0,
        skipped,
        rejected,
        refreshed: 0,
        remaining: userRate.remaining,
      });
    }

    // Global Overpass budget — atomic FOR UPDATE; fail closed before any fetch.
    const globalRateRpc = await serviceClient.rpc('consume_court_ingest_global_rate_limit', {
      p_max_requests: GLOBAL_RATE_LIMIT_MAX_REQUESTS,
      p_window_seconds: GLOBAL_RATE_LIMIT_WINDOW_SECONDS,
    });
    if (globalRateRpc.error) {
      return json(
        {
          ok: false,
          error: 'rate_limit_unavailable',
          inserted: 0,
          skipped,
          rejected,
          remaining: userRate.remaining,
        },
        503
      );
    }
    const globalRate = interpretRateLimitResult(globalRateRpc.data);
    if (!globalRate.allowed) {
      return json(
        {
          ok: false,
          error: 'global_rate_limited',
          inserted: 0,
          skipped,
          rejected,
          remaining: userRate.remaining,
          global_remaining: globalRate.global_remaining ?? 0,
        },
        429
      );
    }

    const query = buildOverpassIdsQuery(toFetch);
    const overpass = await runOverpassMirrorSequence(OVERPASS_ENDPOINTS, (endpoint) =>
      probeOverpass(endpoint, query)
    );
    const overpassAttempts = overpass.attempts.map(publicOverpassAttempt);
    console.log(
      JSON.stringify({
        event: 'overpass_refetch',
        outcome: overpass.outcome,
        reason: overpass.reason,
        attempts: overpassAttempts,
      })
    );

    if (overpass.outcome === 'unavailable') {
      // Temporary miss. Do not count these IDs as rejected; the client retries them.
      return json(
        {
          ok: false,
          error: OVERPASS_UNAVAILABLE_ERROR,
          inserted: 0,
          skipped,
          rejected,
          refreshed: 0,
          retry_ids: retryIdentities(toFetch),
          overpass_error: overpass.reason,
          overpass_attempts: overpassAttempts,
          remaining: userRate.remaining,
          global_remaining: globalRate.global_remaining ?? 0,
        },
        503
      );
    }

    const nowIso = new Date().toISOString();
    const classified = classifyIngestElements(toFetch, overpass.elements ?? [], nowIso);
    rejected += classified.rejected;
    const rows: CourtUpsertRow[] = [];
    for (const row of classified.rows) {
      const existing = existingLookup.bySourceId.get(row.source_id);
      if (existing?.verification_status === 'rejected') {
        skipped += 1;
        continue;
      }
      if (existing?.verification_status === 'verified') {
        refreshed += 1;
      }
      rows.push(row);
    }

    if (rows.length > 0) {
      const { error: upsertError } = await serviceClient.from('courts').upsert(rows, {
        onConflict: 'source,source_id',
        ignoreDuplicates: false,
      });
      if (upsertError) {
        return json(
          {
            ok: false,
            error: 'upsert_failed',
            inserted: 0,
            skipped,
            rejected,
            refreshed: 0,
            remaining: userRate.remaining,
            global_remaining: globalRate.global_remaining ?? 0,
          },
          500
        );
      }
      inserted = rows.length - refreshed;
    }

    return json({
      ok: true,
      inserted,
      skipped,
      rejected,
      refreshed,
      retry_ids: [],
      overpass_attempts: overpassAttempts,
      remaining: userRate.remaining,
      global_remaining: globalRate.global_remaining ?? 0,
    });
  } catch {
    return json({ ok: false, error: 'internal_error', inserted: 0, skipped: 0, rejected: 0 }, 500);
  }
});

async function loadExistingCourts(
  serviceClient: ReturnType<typeof createClient>,
  identities: OsmIdentity[]
): Promise<ReturnType<typeof parseExistingCourtsLookup>> {
  const keys = identities.map((i) => sourceIdKey(i.type, i.id));
  const { data, error } = await serviceClient
    .from('courts')
    .select('source_id, updated_at, verification_status')
    .eq('source', 'overpass')
    .in('source_id', keys);
  return parseExistingCourtsLookup(data, error);
}

async function probeOverpass(endpoint: string, query: string): Promise<MirrorProbe> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
        'User-Agent': 'BallOutBasketball/1.0 (upsert-discovered-courts)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    const duration_ms = Date.now() - started;
    if (!response.ok) {
      return { ok: false, status: response.status, duration_ms, error: 'http_error' };
    }
    try {
      const payload = (await response.json()) as { elements?: OverpassElement[] };
      const elements = Array.isArray(payload.elements) ? payload.elements : [];
      return { ok: true, status: response.status, duration_ms, elements };
    } catch {
      return { ok: false, status: response.status, duration_ms, error: 'invalid_json' };
    }
  } catch (err) {
    const duration_ms = Date.now() - started;
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: null,
      duration_ms,
      error: aborted ? 'timeout' : 'network',
    };
  } finally {
    clearTimeout(timer);
  }
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}
