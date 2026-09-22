# Remote Transport Provider Contract v1

Schema name: `ones.bigcircle-remote-transport-provider/v1alpha1`

Provider profile: `CLOUDFLARE_WORKER_DO_R2_V1`

## Purpose

Carry the exact existing transport-envelope file bytes across the Big-circle <-> Windows trust boundary without changing CASE_FEED / RESULT / CHECKPOINT business semantics.

This contract is transport-only. The provider MUST NOT parse or reinterpret the envelope payload as accepted product truth.

## Components

Production provider implementation is frozen as:

- public HTTPS Cloudflare Worker gateway;
- one Durable Object coordination namespace for ordering, envelope-id dedupe, claim leases and ACK state;
- one private R2 bucket for exact raw envelope-file bytes.

Clients never receive Cloudflare account API tokens.

## Roles and directions

`bigcircle-control`:
- may PUSH only `BIGCIRCLE_TO_WINDOWS`;
- may CLAIM/ACK only `WINDOWS_TO_BIGCIRCLE`.

`windows-agent`:
- may PUSH only `WINDOWS_TO_BIGCIRCLE`;
- may CLAIM/ACK only `BIGCIRCLE_TO_WINDOWS`.

Any other role/direction combination MUST fail closed.

## Exact object

The provider object is the complete UTF-8 JSON envelope **file bytes**, not the decoded payload.

For every stored object:

- `envelopeId` comes from the validated envelope;
- `rawSha256 = sha256(exact envelope file bytes)`;
- existing `payloadSha256` remains independently validated by `transport-envelope/envelope.py`.

Provider storage MUST preserve the exact raw bytes returned by GET/claim.

## Authentication

Each role has a separate random secret. Secrets are runtime configuration only.

Required headers:

- `X-OBT-Role`
- `X-OBT-Timestamp` — UTC Unix seconds
- `X-OBT-Nonce` — unique opaque value, minimum 16 bytes of randomness represented as text
- `X-OBT-Body-SHA256` — lowercase hex SHA-256 of request body bytes
- `X-OBT-Signature` — lowercase hex HMAC-SHA256

Canonical signing bytes are UTF-8:

```text
METHOD\n
PATH_WITH_QUERY\n
ROLE\n
TIMESTAMP\n
NONCE\n
BODY_SHA256
```

The provider MUST:

- recompute the body SHA;
- use constant-time signature comparison;
- reject timestamps outside a configured narrow skew window;
- reject a reused role+nonce within the replay window;
- never log role secrets or signatures.

TLS is mandatory in production. Plain HTTP is permitted only for loopback integration tests.

## API

### PUT /v1/envelopes/{direction}/{envelopeId}

Body: exact envelope-file bytes.

Provider validation before store:
- request role may push this direction;
- JSON envelope validates;
- envelope direction equals path direction;
- envelopeId equals path envelopeId;
- raw SHA matches body;
- existing object with same envelopeId must have identical raw SHA or fail `ENVELOPE_ID_COLLISION`.

Response:

```json
{"status":"STORED|NOOP","envelopeId":"env-...","rawSha256":"..."}
```

A client may delete its local outbox file only after this exact response is validated and `rawSha256` equals the local file SHA.

### POST /v1/claims/{direction}

Body: `{}`.

Provider:
- validates that role may consume the direction;
- selects the oldest unacked envelope for that direction;
- creates or renews one bounded lease;
- returns 204 when none is available.

Success body: exact envelope-file bytes.

Required response headers:
- `X-OBT-Envelope-Id`
- `X-OBT-Raw-SHA256`
- `X-OBT-Lease-Id`

The client MUST validate raw SHA, full envelope semantics, role/direction, and envelopeId before local persistence.

### POST /v1/acks/{direction}/{envelopeId}

Body:

```json
{"leaseId":"...","rawSha256":"..."}
```

ACK is legal only after:
- exact bytes were durably stored in the destination local spool inbox; or
- an existing inbox/claimed/processed file is an exact raw-byte duplicate.

Provider validates current lease, envelopeId and raw SHA.

Response:

```json
{"status":"ACKED","envelopeId":"env-...","rawSha256":"..."}
```

ACK makes the object no longer claimable but does not require immediate R2 deletion. Retention/deletion policy is a later operational contract.

## Delivery semantics

- provider delivery: at least once;
- ordering: per direction, oldest available first;
- one active lease per envelope;
- lease expiry returns an unacked object to claimable state;
- duplicate PUT of identical bytes: `NOOP`;
- duplicate semantic envelope with different raw bytes under same envelopeId: fail closed;
- existing transport spool remains the endpoint idempotency boundary.

## Secret and data boundary

Never store in Git or provider logs:
- role secrets;
- Browser Relay token;
- browser Cookie/Authorization/password;
- Cloudflare account API tokens.

Provider may temporarily store envelope contents because CASE_FEED/RESULT/CHECKPOINT are the transport payload. R2 bucket is private; access is only through the Worker binding.

## Frozen non-scope

This contract does not:
- enable ONES writes;
- enable automatic ONES create/import;
- enable owner/status/project/priority/delete mutation;
- change Browser/Relay capabilities;
- make Issue #20 part of Gate D2;
- define production retention duration;
- authorize deployment before provider implementation and executable gates pass.
