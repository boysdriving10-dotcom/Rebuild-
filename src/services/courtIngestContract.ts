/**
 * Shared client contract for upsert-discovered-courts.
 * HTTP 503 and ok:false both fail the batch so the map cooldown can retry.
 */

export const INGEST_COOLDOWN_MS = 30_000;

export type DiscoveredCourtCounts = {
  inserted: number;
  skipped: number;
  rejected: number;
  refreshed?: number;
  remaining?: number;
};

export type DiscoveredCourtInvokeResult =
  | { ok: true; data: DiscoveredCourtCounts }
  | { ok: false; error: string };

type InvokeError = {
  message?: string;
  context?: { status?: number };
} | null;

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  return payload as Record<string, unknown>;
}

/**
 * Map a Supabase function invoke result onto the court-ingest result.
 * A 503 body with ok:false is a temporary Overpass miss, not a completed batch.
 */
export function interpretDiscoveredCourtInvoke(input: {
  httpStatus: number | null;
  payload: unknown;
  transportError?: string | null;
}): DiscoveredCourtInvokeResult {
  const payload = payloadRecord(input.payload);
  const payloadOk = payload?.ok;
  const payloadError = typeof payload?.error === 'string' ? payload.error : null;

  if (input.httpStatus === 503 || payloadOk === false) {
    return {
      ok: false,
      error: payloadError || input.transportError || 'Court discovery failed.',
    };
  }

  if (input.transportError) {
    return { ok: false, error: input.transportError };
  }

  if (!payload) {
    return { ok: false, error: 'Unexpected response from court discovery.' };
  }

  return {
    ok: true,
    data: {
      inserted: Number(payload.inserted) || 0,
      skipped: Number(payload.skipped) || 0,
      rejected: Number(payload.rejected) || 0,
      refreshed: typeof payload.refreshed === 'number' ? payload.refreshed : undefined,
      remaining: typeof payload.remaining === 'number' ? payload.remaining : undefined,
    },
  };
}

/** Read the HTTP status Supabase attaches to a non-2xx FunctionsHttpError, when present. */
export function httpStatusFromInvokeError(error: InvokeError): number | null {
  const status = error?.context?.status;
  return typeof status === 'number' ? status : null;
}

type JsonBody = { json: () => Promise<unknown>; clone?: () => JsonBody };

/**
 * supabase-js returns data: null for non-2xx and leaves the Response on error.context.
 * Read that body so a 503 overpass_unavailable result is visible to the caller.
 */
export async function readFunctionInvokePayload(
  data: unknown,
  error: InvokeError
): Promise<unknown> {
  if (data != null) return data;
  const context = error?.context as (JsonBody & { status?: number }) | undefined;
  const source = context?.clone?.() ?? context;
  if (!source || typeof source.json !== 'function') return null;
  try {
    return await source.json();
  } catch {
    return null;
  }
}

export function interpretSupabaseFunctionInvoke(result: {
  data: unknown;
  error: InvokeError;
}): DiscoveredCourtInvokeResult {
  const httpStatus = result.error ? httpStatusFromInvokeError(result.error) : 200;
  return interpretDiscoveredCourtInvoke({
    httpStatus,
    payload: result.data,
    transportError: result.error?.message ?? null,
  });
}

/**
 * One step of the map ingest loop.
 * A failed batch starts the 30-second cooldown and stops. Success continues.
 */
export function onIngestBatchResult(
  now: number,
  outcomeOk: boolean
): { cooldownUntil: number | null; continueLoop: boolean } {
  if (!outcomeOk) {
    return { cooldownUntil: now + INGEST_COOLDOWN_MS, continueLoop: false };
  }
  return { cooldownUntil: null, continueLoop: true };
}
