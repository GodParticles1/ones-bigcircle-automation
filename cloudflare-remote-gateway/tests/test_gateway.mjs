import worker, { TransportCoordinator } from "../src/index.mjs";

const encoder = new TextEncoder();

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes) {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stableJson(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}

class FakeStorage {
  constructor() {
    this.map = new Map();
  }

  async get(key) {
    return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined;
  }

  async put(key, value) {
    this.map.set(key, structuredClone(value));
  }

  async delete(keyOrKeys) {
    if (Array.isArray(keyOrKeys)) {
      for (const key of keyOrKeys) this.map.delete(key);
    } else {
      this.map.delete(keyOrKeys);
    }
  }

  async list(options = {}) {
    const prefix = options.prefix || "";
    const limit = options.limit || Number.MAX_SAFE_INTEGER;
    const entries = [...this.map.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, limit)
      .map(([k, v]) => [k, structuredClone(v)]);
    return new Map(entries);
  }

  async transaction(fn) {
    return fn(this);
  }
}

class FakeStub {
  constructor(obj) {
    this.obj = obj;
  }
  async fetch(request) {
    return this.obj.fetch(request);
  }
}

class FakeNamespace {
  constructor(env) {
    this.env = env;
    this.objects = new Map();
  }
  idFromName(name) {
    return name;
  }
  get(id) {
    if (!this.objects.has(id)) {
      const ctx = { storage: new FakeStorage() };
      this.objects.set(id, new TransportCoordinator(ctx, this.env));
    }
    return new FakeStub(this.objects.get(id));
  }
}

class FakeR2 {
  constructor() {
    this.objects = new Map();
  }
  async head(key) {
    const x = this.objects.get(key);
    if (!x) return null;
    return { customMetadata: structuredClone(x.customMetadata) };
  }
  async put(key, value, options = {}) {
    const bytes = new Uint8Array(value);
    this.objects.set(key, {
      bytes: new Uint8Array(bytes),
      customMetadata: structuredClone(options.customMetadata || {}),
    });
    return { key, customMetadata: structuredClone(options.customMetadata || {}) };
  }
  async get(key) {
    const x = this.objects.get(key);
    if (!x) return null;
    return {
      customMetadata: structuredClone(x.customMetadata),
      async arrayBuffer() {
        return new Uint8Array(x.bytes).buffer;
      },
    };
  }
}

async function buildEnvelope(payload, direction, kind, producer, consumer) {
  const payloadBytes = encoder.encode(stableJson(payload));
  const payloadSha256 = await sha256Hex(payloadBytes);
  const seed = {
    schema: "ones.bigcircle-transport-envelope/v1alpha1",
    direction,
    kind,
    producer,
    consumer,
    payloadSha256,
  };
  const identity = await sha256Hex(encoder.encode(stableJson(seed)));
  return {
    schema: "ones.bigcircle-transport-envelope/v1alpha1",
    envelopeId: "env-" + identity,
    idempotencyKey: "idem-" + identity,
    direction,
    kind,
    createdAt: "2026-09-22T00:00:00Z",
    producer,
    consumer,
    payloadEncoding: "json-utf8+base64",
    payloadSha256,
    payloadBase64: Buffer.from(payloadBytes).toString("base64"),
  };
}

async function signedRequest(env, method, path, role, body, options = {}) {
  const bodyBytes = body instanceof Uint8Array ? body : encoder.encode(body || "");
  const bodySha = await sha256Hex(bodyBytes);
  const timestamp = options.timestamp || Math.floor(Date.now() / 1000);
  const nonce = options.nonce || "nonce-" + crypto.randomUUID();
  const secret = role === "bigcircle-control" ? env.BIGCIRCLE_HMAC_SECRET : env.WINDOWS_HMAC_SECRET;
  const canonical = [method, path, role, String(timestamp), nonce, bodySha].join("\n");
  const signature = options.signature || await hmacHex(secret, canonical);
  return new Request("https://transport.example" + path, {
    method,
    body: bodyBytes.length ? bodyBytes : undefined,
    headers: {
      "X-OBT-Role": role,
      "X-OBT-Timestamp": String(timestamp),
      "X-OBT-Nonce": nonce,
      "X-OBT-Body-SHA256": bodySha,
      "X-OBT-Signature": signature,
    },
  });
}

async function call(env, request) {
  return worker.fetch(request, env);
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

async function json(resp) {
  return JSON.parse(await resp.text());
}

async function putEnvelope(env, role, envelope, rawBytes, nonce = undefined) {
  const path = `/v1/envelopes/${envelope.direction}/${envelope.envelopeId}`;
  return call(env, await signedRequest(env, "PUT", path, role, rawBytes, { nonce }));
}

async function claim(env, role, direction, nonce = undefined) {
  const path = `/v1/claims/${direction}`;
  return call(env, await signedRequest(env, "POST", path, role, "{}", { nonce }));
}

async function ack(env, role, direction, envelopeId, leaseId, rawSha256) {
  const path = `/v1/acks/${direction}/${envelopeId}`;
  const body = JSON.stringify({ leaseId, rawSha256 });
  return call(env, await signedRequest(env, "POST", path, role, body));
}

async function main() {
  const env = {
    BIGCIRCLE_HMAC_SECRET: "B".repeat(48),
    WINDOWS_HMAC_SECRET: "W".repeat(48),
    AUTH_MAX_SKEW_SECONDS: "300",
    CLAIM_LEASE_SECONDS: "60",
    ENVELOPE_BUCKET: new FakeR2(),
  };
  env.TRANSPORT_COORDINATOR = new FakeNamespace(env);

  const caseEnvelope = await buildEnvelope(
    {
      schema: "bigcircle.confirmed-case-export/v1alpha1",
      complete: true,
      exportedCaseCount: 0,
      cases: [],
    },
    "BIGCIRCLE_TO_WINDOWS",
    "CASE_FEED",
    "bigcircle-control",
    "windows-agent",
  );
  const caseRaw = encoder.encode(JSON.stringify(caseEnvelope, null, 2) + "\n");
  const caseRawSha = await sha256Hex(caseRaw);

  let resp = await putEnvelope(env, "bigcircle-control", caseEnvelope, caseRaw);
  assert(resp.status === 200, "forward put status");
  let doc = await json(resp);
  assert(doc.status === "STORED" && doc.rawSha256 === caseRawSha, "forward stored");

  resp = await putEnvelope(env, "bigcircle-control", caseEnvelope, caseRaw);
  assert(resp.status === 200 && (await json(resp)).status === "NOOP", "duplicate put noop");

  resp = await putEnvelope(env, "windows-agent", caseEnvelope, caseRaw);
  assert(resp.status === 403, "wrong role push must fail");

  const replayNonce = "nonce-replay-fixed-0123456789";
  resp = await claim(env, "windows-agent", "BIGCIRCLE_TO_WINDOWS", replayNonce);
  assert(resp.status === 200, "first claim");
  const leasedRaw = new Uint8Array(await resp.arrayBuffer());
  assert(Buffer.compare(Buffer.from(leasedRaw), Buffer.from(caseRaw)) === 0, "exact R2 bytes");
  const leaseId = resp.headers.get("X-OBT-Lease-Id");
  assert(resp.headers.get("X-OBT-Raw-SHA256") === caseRawSha, "claim raw sha");

  const replayResp = await claim(env, "windows-agent", "BIGCIRCLE_TO_WINDOWS", replayNonce);
  assert(replayResp.status === 409 && (await json(replayResp)).error === "NONCE_REPLAY", "nonce replay");

  resp = await claim(env, "windows-agent", "BIGCIRCLE_TO_WINDOWS");
  assert(resp.status === 204, "active lease blocks second claim");

  resp = await ack(
    env,
    "windows-agent",
    "BIGCIRCLE_TO_WINDOWS",
    caseEnvelope.envelopeId,
    leaseId,
    caseRawSha,
  );
  assert(resp.status === 200 && (await json(resp)).status === "ACKED", "forward ack");

  resp = await claim(env, "windows-agent", "BIGCIRCLE_TO_WINDOWS");
  assert(resp.status === 204, "acked item gone");

  // Same immutable envelope with different file formatting must collide at raw-byte boundary.
  const compactRaw = encoder.encode(JSON.stringify(caseEnvelope));
  assert(await sha256Hex(compactRaw) !== caseRawSha, "raw formatting differs");
  resp = await putEnvelope(env, "bigcircle-control", caseEnvelope, compactRaw);
  assert(resp.status === 409 && (await json(resp)).error === "ENVELOPE_ID_COLLISION", "raw collision");

  // Invalid signature fails before provider state mutation.
  const badPath = `/v1/claims/BIGCIRCLE_TO_WINDOWS`;
  const badReq = await signedRequest(env, "POST", badPath, "windows-agent", "{}", {
    signature: "0".repeat(64),
  });
  resp = await call(env, badReq);
  assert(resp.status === 401 && (await json(resp)).error === "AUTH_SIGNATURE_MISMATCH", "bad signature");

  // Windows -> Big-circle reverse path.
  const resultEnvelope = await buildEnvelope(
    {
      schema: "ones.bigcircle-transport-result/v1alpha1",
      status: "RECONCILIATION_VERIFIED",
      caseFeedSha256: "a".repeat(64),
      inventorySha256: "b".repeat(64),
      reconciliationRunKey: "c".repeat(64),
      reconciliationOutput: "synthetic.json",
    },
    "WINDOWS_TO_BIGCIRCLE",
    "RESULT",
    "windows-agent",
    "bigcircle-control",
  );
  const resultRaw = encoder.encode(JSON.stringify(resultEnvelope, null, 2) + "\n");
  const resultSha = await sha256Hex(resultRaw);

  resp = await putEnvelope(env, "windows-agent", resultEnvelope, resultRaw);
  assert(resp.status === 200 && (await json(resp)).status === "STORED", "reverse store");

  resp = await claim(env, "bigcircle-control", "WINDOWS_TO_BIGCIRCLE");
  assert(resp.status === 200, "reverse claim");
  const reverseLease = resp.headers.get("X-OBT-Lease-Id");
  const reverseRaw = new Uint8Array(await resp.arrayBuffer());
  assert(Buffer.compare(Buffer.from(reverseRaw), Buffer.from(resultRaw)) === 0, "reverse exact bytes");

  resp = await ack(
    env,
    "bigcircle-control",
    "WINDOWS_TO_BIGCIRCLE",
    resultEnvelope.envelopeId,
    reverseLease,
    resultSha,
  );
  assert(resp.status === 200, "reverse ack");

  // R2 corruption must fail closed before returning bytes.
  const corruptEnvelope = await buildEnvelope(
    {
      schema: "bigcircle.confirmed-case-export/v1alpha1",
      complete: true,
      exportedCaseCount: 1,
      cases: [{ localCaseId: "synthetic-2" }],
    },
    "BIGCIRCLE_TO_WINDOWS",
    "CASE_FEED",
    "bigcircle-control",
    "windows-agent",
  );
  const corruptRaw = encoder.encode(JSON.stringify(corruptEnvelope, null, 2) + "\n");
  resp = await putEnvelope(env, "bigcircle-control", corruptEnvelope, corruptRaw);
  assert(resp.status === 200, "corrupt-test initial put");
  const key = "BIGCIRCLE_TO_WINDOWS/" + corruptEnvelope.envelopeId + ".json";
  env.ENVELOPE_BUCKET.objects.get(key).bytes[0] ^= 1;

  resp = await claim(env, "windows-agent", "BIGCIRCLE_TO_WINDOWS");
  assert(resp.status === 503 && (await json(resp)).error === "R2_RAW_SHA_MISMATCH", "R2 corruption fail closed");

  console.log("CLOUDFLARE_REMOTE_GATEWAY_P4H_TEST_PASS");
}

await main();
