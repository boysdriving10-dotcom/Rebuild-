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
  buildOverpassIdsQuery,
  courtRowFromOverpassElement,
  decideUserAuth,
  enforceIdCap,
  interpretRateLimitResult,
  parseExistingCourtsLookup,
  parseOsmIdentities,
  partitionIdentitiesForFetch,
  sourceIdKey,
  type CourtUpsertRow,
  type OsmIdentity,
  type OverpassElement,
} from './ingestLogic.ts';

const OVERPASS_ENDPOINTS = [
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

    const rateRpc = await serviceClient.rpc('consume_court_ingest_rate_limit', {
      p_user_id: auth.userId,
      p_max_requests: RATE_LIMIT_MAX_REQUESTS,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      p_global_max_requests: GLOBAL_RATE_LIMIT_MAX_REQUESTS,
      p_global_window_seconds: GLOBAL_RATE_LIMIT_WINDOW_SECONDS,
    });
    if (rateRpc.error) {
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
    const rate = interpretRateLimitResult(rateRpc.data);
    if (!rate.allowed) {
      const error =
        rate.reason === 'global_rate_limited' ? 'global_rate_limited' : 'rate_limited';
      return json(
        {
          ok: false,
          error,
          inserted: 0,
          skipped: 0,
          rejected: 0,
          remaining: rate.remaining,
          global_remaining: rate.global_remaining ?? 0,
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
        remaining: rate.remaining,
        global_remaining: rate.global_remaining ?? 0,
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
          remaining: rate.remaining,
          global_remaining: rate.global_remaining ?? 0,
        },
        503
      );
    }

    const partitioned = partitionIdentitiesForFetch(
      identities,
      existingLookup.bySourceId,
      Date.now()
    );
    skipped += partitioned.skippedFresh;
    const toFetch = partitioned.toFetch;

    if (toFetch.length === 0) {
      return json({
        ok: true,
        inserted: 0,
        skipped,
        rejected,
        refreshed: 0,
        remaining: rate.remaining,
        global_remaining: rate.global_remaining ?? 0,
      });
    }

    const overpass = await fetchOverpassElements(toFetch);
    if (!overpass.ok) {
      // Soft failure: do not crash; nothing inserted.
      return json({
        ok: true,
        inserted: 0,
        skipped,
        rejected: rejected + toFetch.length,
        refreshed: 0,
        overpass_error: overpass.error,
        remaining: rate.remaining,
        global_remaining: rate.global_remaining ?? 0,
      });
    }

    const nowIso = new Date().toISOString();
    const rows: CourtUpsertRow[] = [];
    const seenFetched = new Set<string>();
    for (const identity of toFetch) {
      const key = sourceIdKey(identity.type, identity.id);
      const el = overpass.byKey.get(key);
      if (!el) {
        rejected += 1;
        continue;
      }
      const row = courtRowFromOverpassElement(el, nowIso);
      if (!row) {
        rejected += 1;
        continue;
      }
      if (seenFetched.has(row.source_id)) {
        skipped += 1;
        continue;
      }
      seenFetched.add(row.source_id);
      if (existingLookup.bySourceId.has(row.source_id)) {
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
            remaining: rate.remaining,
            global_remaining: rate.global_remaining ?? 0,
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
      remaining: rate.remaining,
      global_remaining: rate.global_remaining ?? 0,
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
    .select('source_id, updated_at')
    .eq('source', 'overpass')
    .in('source_id', keys);
  return parseExistingCourtsLookup(data, error);
}

async function fetchOverpassElements(identities: OsmIdentity[]): Promise<
  | { ok: true; byKey: Map<string, OverpassElement> }
  | { ok: false; error: 'timeout' | 'network' | 'invalid_json' | 'http_error' | 'empty' }
> {
  const query = buildOverpassIdsQuery(identities);
  let lastError: 'timeout' | 'network' | 'invalid_json' | 'http_error' | 'empty' = 'network';

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!response.ok) {
        lastError = 'http_error';
        continue;
      }
      let payload: { elements?: OverpassElement[] };
      try {
        payload = (await response.json()) as { elements?: OverpassElement[] };
      } catch {
        lastError = 'invalid_json';
        continue;
      }
      const elements = Array.isArray(payload.elements) ? payload.elements : [];
      if (elements.length === 0) {
        lastError = 'empty';
        // Empty can be legitimate (ids gone); treat as ok with empty map.
        return { ok: true, byKey: new Map() };
      }
      const byKey = new Map<string, OverpassElement>();
      for (const el of elements) {
        if ((el.type === 'node' || el.type === 'way') && typeof el.id === 'number') {
          byKey.set(sourceIdKey(el.type, el.id), el);
        }
      }
      return { ok: true, byKey };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = 'timeout';
      } else {
        lastError = 'network';
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: lastError };
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
