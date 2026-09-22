const SCHEMA = "ones.bigcircle-transport-envelope/v1alpha1";
const KIND_DIRECTIONS = {
  CASE_FEED: "BIGCIRCLE_TO_WINDOWS",
  RESULT: "WINDOWS_TO_BIGCIRCLE",
  CHECKPOINT: "WINDOWS_TO_BIGCIRCLE",
};
const ROLE_PUSH_DIRECTION = {
  "bigcircle-control": "BIGCIRCLE_TO_WINDOWS",
  "windows-agent": "WINDOWS_TO_BIGCIRCLE",
};
const ROLE_PULL_DIRECTION = {
  "bigcircle-control": "WINDOWS_TO_BIGCIRCLE",
  "windows-agent": "BIGCIRCLE_TO_WINDOWS",
};

const H = {
  role: "X-OBT-Role",
  timestamp: "X-OBT-Timestamp",
  nonce: "X-OBT-Nonce",
  bodySha: "X-OBT-Body-SHA256",
  signature: "X-OBT-Signature",
  envelopeId: "X-OBT-Envelope-Id",
  rawSha: "X-OBT-Raw-SHA256",
  leaseId: "X-OBT-Lease-Id",
};

function jsonResponse(status, value, extra = {}) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function errorResponse(status, code) {
  return jsonResponse(status, { ok: false, error: code });
}

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex || "")) throw new Error("SHA256_HEX_INVALID");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out.buffer;
}

export async function sha256Hex(bytes) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function validateEnvelope(rawBytes) {
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder("utf-8").decode(rawBytes));
  } catch {
    throw new Error("ENVELOPE_FILE_INVALID");
  }
  if (!envelope || envelope.schema !== SCHEMA) throw new Error("SCHEMA_UNSUPPORTED");
  const kind = envelope.kind;
  const direction = envelope.direction;
  if (!KIND_DIRECTIONS[kind] || KIND_DIRECTIONS[kind] !== direction) {
    throw new Error("DIRECTION_KIND_MISMATCH");
  }
  if (typeof envelope.producer !== "string" || !envelope.producer.trim()) throw new Error("PRODUCER_INVALID");
  if (typeof envelope.consumer !== "string" || !envelope.consumer.trim()) throw new Error("CONSUMER_INVALID");
  if (envelope.payloadEncoding !== "json-utf8+base64") throw new Error("PAYLOAD_ENCODING_UNSUPPORTED");
  if (typeof envelope.payloadBase64 !== "string" || !envelope.payloadBase64) throw new Error("PAYLOAD_MISSING");

  let payloadBytes;
  try {
    const binary = atob(envelope.payloadBase64);
    payloadBytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  } catch {
    throw new Error("PAYLOAD_BASE64_INVALID");
  }
  const payloadSha = await sha256Hex(payloadBytes);
  if (payloadSha !== envelope.payloadSha256) throw new Error("PAYLOAD_SHA256_MISMATCH");

  try {
    const payload = JSON.parse(new TextDecoder("utf-8").decode(payloadBytes));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
  } catch {
    throw new Error("PAYLOAD_JSON_INVALID");
  }

  const seed = {
    schema: SCHEMA,
    direction,
    kind,
    producer: envelope.producer.trim(),
    consumer: envelope.consumer.trim(),
    payloadSha256: payloadSha,
  };
  const identitySha = await sha256Hex(new TextEncoder().encode(canonicalJson(seed)));
  const expectedEnvelopeId = "env-" + identitySha;
  const expectedIdem = "idem-" + identitySha;
  if (envelope.envelopeId !== expectedEnvelopeId) throw new Error("ENVELOPE_ID_MISMATCH");
  if (envelope.idempotencyKey !== expectedIdem) throw new Error("IDEMPOTENCY_KEY_MISMATCH");
  return envelope;
}

function canonicalSigningBytes(method, pathWithQuery, role, timestamp, nonce, bodySha) {
  return new TextEncoder().encode([
    method.toUpperCase(),
    pathWithQuery,
    role,
    String(timestamp),
    nonce,
    bodySha,
  ].join("\n"));
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, data));
}

function constantTimeHexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

function roleSecret(env, role) {
  if (role === "bigcircle-control") return env.BIGCIRCLE_HMAC_SECRET;
  if (role === "windows-agent") return env.WINDOWS_HMAC_SECRET;
  return null;
}

async function doRequest(env, name, path, method = "POST", body = null) {
  const id = env.TRANSPORT_COORDINATOR.idFromName(name);
  const stub = env.TRANSPORT_COORDINATOR.get(id);
  return stub.fetch(new Request("https://do" + path, { method, body }));
}

async function verifyAuth(request, env, bodyBytes) {
  const url = new URL(request.url);
  const role = request.headers.get(H.role);
  const timestampText = request.headers.get(H.timestamp);
  const nonce = request.headers.get(H.nonce);
  const bodySha = request.headers.get(H.bodySha);
  const signature = request.headers.get(H.signature);
  const secret = roleSecret(env, role);

  if (!secret || typeof secret !== "string" || secret.length < 32) throw new Error("AUTH_ROLE_INVALID");
  if (!timestampText || !/^\d+$/.test(timestampText)) throw new Error("AUTH_TIMESTAMP_INVALID");
  if (!nonce || nonce.length < 16 || nonce.length > 200) throw new Error("AUTH_NONCE_INVALID");
  if (!/^[0-9a-f]{64}$/.test(bodySha || "")) throw new Error("AUTH_BODY_SHA_INVALID");
  if (!/^[0-9a-f]{64}$/.test(signature || "")) throw new Error("AUTH_SIGNATURE_INVALID");

  const actualBodySha = await sha256Hex(bodyBytes);
  if (!constantTimeHexEqual(actualBodySha, bodySha)) throw new Error("AUTH_BODY_SHA_MISMATCH");

  const maxSkew = Number(env.AUTH_MAX_SKEW_SECONDS || 300);
  const timestamp = Number(timestampText);
  if (!Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > maxSkew) {
    throw new Error("AUTH_TIMESTAMP_STALE");
  }

  const expected = await hmacHex(
    secret,
    canonicalSigningBytes(request.method, url.pathname + url.search, role, timestampText, nonce, bodySha),
  );
  if (!constantTimeHexEqual(expected, signature)) throw new Error("AUTH_SIGNATURE_MISMATCH");

  const replay = await doRequest(
    env,
    "auth:" + role,
    "/internal/auth-nonce",
    "POST",
    JSON.stringify({ nonce, timestamp, maxSkew }),
  );
  if (replay.status !== 200) {
    const detail = await replay.json().catch(() => ({}));
    throw new Error(detail.error || "AUTH_REPLAY_REJECTED");
  }
  return role;
}

function parseRoute(pathname) {
  const p = pathname.split("/").filter(Boolean);
  if (p.length === 4 && p[0] === "v1" && p[1] === "envelopes") {
    return { kind: "push", direction: p[2], envelopeId: p[3] };
  }
  if (p.length === 3 && p[0] === "v1" && p[1] === "claims") {
    return { kind: "claim", direction: p[2] };
  }
  if (p.length === 4 && p[0] === "v1" && p[1] === "acks") {
    return { kind: "ack", direction: p[2], envelopeId: p[3] };
  }
  return null;
}

function r2Key(direction, envelopeId) {
  return direction + "/" + envelopeId + ".json";
}

async function handlePush(request, env, role, route, bodyBytes) {
  if (ROLE_PUSH_DIRECTION[role] !== route.direction) return errorResponse(403, "ROLE_DIRECTION_FORBIDDEN");
  const envelope = await validateEnvelope(bodyBytes);
  if (envelope.direction !== route.direction || envelope.envelopeId !== route.envelopeId) {
    return errorResponse(400, "ROUTE_MISMATCH");
  }

  const rawSha256 = await sha256Hex(bodyBytes);
  const key = r2Key(route.direction, route.envelopeId);
  const existing = await env.ENVELOPE_BUCKET.head(key);
  let providerStatus = "STORED";

  if (existing) {
    if (existing.customMetadata?.rawSha256 !== rawSha256) return errorResponse(409, "ENVELOPE_ID_COLLISION");
    providerStatus = "NOOP";
  } else {
    const stored = await env.ENVELOPE_BUCKET.put(key, bodyBytes, {
      sha256: hexToBytes(rawSha256),
      customMetadata: {
        rawSha256,
        envelopeId: route.envelopeId,
        direction: route.direction,
      },
    });
    if (!stored) return errorResponse(503, "R2_PUT_FAILED");
  }

  const coordination = await doRequest(
    env,
    "lane:" + route.direction,
    "/internal/store",
    "POST",
    JSON.stringify({
      direction: route.direction,
      envelopeId: route.envelopeId,
      rawSha256,
      r2Key: key,
    }),
  );
  if (coordination.status !== 200) {
    const detail = await coordination.json().catch(() => ({}));
    return errorResponse(coordination.status, detail.error || "COORDINATOR_STORE_FAILED");
  }

  return jsonResponse(200, {
    status: providerStatus,
    envelopeId: route.envelopeId,
    rawSha256,
  });
}

async function handleClaim(env, role, route) {
  if (ROLE_PULL_DIRECTION[role] !== route.direction) return errorResponse(403, "ROLE_DIRECTION_FORBIDDEN");
  const leaseSeconds = Number(env.CLAIM_LEASE_SECONDS || 60);
  const coordination = await doRequest(
    env,
    "lane:" + route.direction,
    "/internal/claim",
    "POST",
    JSON.stringify({ now: Date.now(), leaseSeconds }),
  );
  if (coordination.status === 204) return new Response(null, { status: 204 });
  if (coordination.status !== 200) {
    const detail = await coordination.json().catch(() => ({}));
    return errorResponse(coordination.status, detail.error || "COORDINATOR_CLAIM_FAILED");
  }
  const meta = await coordination.json();
  const obj = await env.ENVELOPE_BUCKET.get(meta.r2Key);
  if (!obj) return errorResponse(503, "R2_OBJECT_MISSING");
  const raw = new Uint8Array(await obj.arrayBuffer());
  const rawSha256 = await sha256Hex(raw);
  if (rawSha256 !== meta.rawSha256 || obj.customMetadata?.rawSha256 !== meta.rawSha256) {
    return errorResponse(503, "R2_RAW_SHA_MISMATCH");
  }
  const envelope = await validateEnvelope(raw);
  if (envelope.envelopeId !== meta.envelopeId || envelope.direction !== route.direction) {
    return errorResponse(503, "R2_ENVELOPE_MISMATCH");
  }

  return new Response(raw, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      [H.envelopeId]: meta.envelopeId,
      [H.rawSha]: meta.rawSha256,
      [H.leaseId]: meta.leaseId,
    },
  });
}

async function handleAck(bodyBytes, env, role, route) {
  if (ROLE_PULL_DIRECTION[role] !== route.direction) return errorResponse(403, "ROLE_DIRECTION_FORBIDDEN");
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return errorResponse(400, "ACK_INVALID");
  }
  if (!body || typeof body.leaseId !== "string" || !/^[0-9a-f]{64}$/.test(body.rawSha256 || "")) {
    return errorResponse(400, "ACK_INVALID");
  }

  const coordination = await doRequest(
    env,
    "lane:" + route.direction,
    "/internal/ack",
    "POST",
    JSON.stringify({
      now: Date.now(),
      envelopeId: route.envelopeId,
      leaseId: body.leaseId,
      rawSha256: body.rawSha256,
    }),
  );
  if (coordination.status !== 200) {
    const detail = await coordination.json().catch(() => ({}));
    return errorResponse(coordination.status, detail.error || "ACK_REJECTED");
  }
  return jsonResponse(200, {
    status: "ACKED",
    envelopeId: route.envelopeId,
    rawSha256: body.rawSha256,
  });
}

export default {
  async fetch(request, env) {
    const route = parseRoute(new URL(request.url).pathname);
    if (!route) return errorResponse(404, "NOT_FOUND");

    let bodyBytes;
    try {
      bodyBytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return errorResponse(400, "BODY_READ_FAILED");
    }

    let role;
    try {
      role = await verifyAuth(request, env, bodyBytes);
    } catch (err) {
      const code = String(err?.message || err);
      const status = code === "NONCE_REPLAY" ? 409 : 401;
      return errorResponse(status, code);
    }

    try {
      if (route.kind === "push" && request.method === "PUT") {
        return await handlePush(request, env, role, route, bodyBytes);
      }
      if (route.kind === "claim" && request.method === "POST") {
        return await handleClaim(env, role, route);
      }
      if (route.kind === "ack" && request.method === "POST") {
        return await handleAck(bodyBytes, env, role, route);
      }
      return errorResponse(405, "METHOD_NOT_ALLOWED");
    } catch (err) {
      return errorResponse(400, String(err?.message || err));
    }
  },
};

export class TransportCoordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST") return errorResponse(405, "METHOD_NOT_ALLOWED");
    let body = {};
    try {
      body = JSON.parse(await request.text());
    } catch {
      return errorResponse(400, "INTERNAL_BODY_INVALID");
    }

    if (path === "/internal/auth-nonce") return this.authNonce(body);
    if (path === "/internal/store") return this.store(body);
    if (path === "/internal/claim") return this.claim(body);
    if (path === "/internal/ack") return this.ack(body);
    return errorResponse(404, "NOT_FOUND");
  }

  async authNonce(body) {
    if (typeof body.nonce !== "string" || !Number.isFinite(body.timestamp) || !Number.isFinite(body.maxSkew)) {
      return errorResponse(400, "AUTH_NONCE_INPUT_INVALID");
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec - Math.max(body.maxSkew * 2, 600);
    const all = await this.ctx.storage.list({ prefix: "nonce:" });
    const deletes = [];
    for (const [key, value] of all) {
      if (Number(value) < cutoff) deletes.push(key);
    }
    if (deletes.length) await this.ctx.storage.delete(deletes);

    const key = "nonce:" + body.nonce;
    if (await this.ctx.storage.get(key) !== undefined) return errorResponse(409, "NONCE_REPLAY");
    await this.ctx.storage.put(key, body.timestamp);
    return jsonResponse(200, { ok: true });
  }

  async store(body) {
    if (
      typeof body.direction !== "string" ||
      typeof body.envelopeId !== "string" ||
      !/^[0-9a-f]{64}$/.test(body.rawSha256 || "") ||
      typeof body.r2Key !== "string"
    ) {
      return errorResponse(400, "STORE_INPUT_INVALID");
    }

    return this.ctx.storage.transaction(async txn => {
      const metaKey = "meta:" + body.envelopeId;
      const existing = await txn.get(metaKey);
      if (existing) {
        if (
          existing.rawSha256 !== body.rawSha256 ||
          existing.r2Key !== body.r2Key ||
          existing.direction !== body.direction
        ) {
          return errorResponse(409, "ENVELOPE_ID_COLLISION");
        }
        return jsonResponse(200, { status: "NOOP" });
      }

      const next = Number((await txn.get("nextSeq")) || 0) + 1;
      const seqKey = "item:" + String(next).padStart(20, "0");
      const meta = {
        ...body,
        seqKey,
        leaseId: null,
        leaseExpiresAt: 0,
      };
      await txn.put("nextSeq", next);
      await txn.put(seqKey, body.envelopeId);
      await txn.put(metaKey, meta);
      return jsonResponse(200, { status: "STORED" });
    });
  }

  async claim(body) {
    const now = Number(body.now);
    const leaseSeconds = Math.max(5, Math.min(300, Number(body.leaseSeconds || 60)));
    if (!Number.isFinite(now)) return errorResponse(400, "CLAIM_INPUT_INVALID");

    return this.ctx.storage.transaction(async txn => {
      const items = await txn.list({ prefix: "item:", limit: 1 });
      const first = items.entries().next();
      if (first.done) return new Response(null, { status: 204 });
      const [, envelopeId] = first.value;
      const metaKey = "meta:" + envelopeId;
      const meta = await txn.get(metaKey);
      if (!meta) return errorResponse(503, "COORDINATOR_META_MISSING");
      if (meta.leaseId && Number(meta.leaseExpiresAt) > now) {
        return new Response(null, { status: 204 });
      }
      const leaseId = crypto.randomUUID();
      const updated = {
        ...meta,
        leaseId,
        leaseExpiresAt: now + leaseSeconds * 1000,
      };
      await txn.put(metaKey, updated);
      return jsonResponse(200, {
        envelopeId: updated.envelopeId,
        rawSha256: updated.rawSha256,
        r2Key: updated.r2Key,
        leaseId,
      });
    });
  }

  async ack(body) {
    const now = Number(body.now);
    if (
      !Number.isFinite(now) ||
      typeof body.envelopeId !== "string" ||
      typeof body.leaseId !== "string" ||
      !/^[0-9a-f]{64}$/.test(body.rawSha256 || "")
    ) {
      return errorResponse(400, "ACK_INPUT_INVALID");
    }

    return this.ctx.storage.transaction(async txn => {
      const metaKey = "meta:" + body.envelopeId;
      const meta = await txn.get(metaKey);
      if (!meta) return errorResponse(404, "ENVELOPE_NOT_FOUND");
      if (meta.rawSha256 !== body.rawSha256) return errorResponse(409, "RAW_SHA_MISMATCH");
      if (meta.leaseId !== body.leaseId) return errorResponse(409, "LEASE_MISMATCH");
      if (Number(meta.leaseExpiresAt) < now) return errorResponse(409, "LEASE_EXPIRED");
      await txn.delete(meta.seqKey);
      await txn.put(metaKey, {
        ...meta,
        ackedAt: now,
        leaseId: null,
        leaseExpiresAt: 0,
      });
      return jsonResponse(200, { status: "ACKED" });
    });
  }
}

export { H, canonicalSigningBytes, validateEnvelope };
