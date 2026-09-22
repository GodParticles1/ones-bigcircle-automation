# P4i Cloudflare staging deployment and acceptance

This runbook is for staging only and carries synthetic transport envelopes only.

## Frozen lineage

Before deployment, record:

- repository main SHA;
- P4g contract merge;
- P4h gateway merge;
- exact config file SHA256;
- Wrangler version;
- Cloudflare account/environment selected by the operator.

Do not put account IDs, API tokens, HMAC secrets, Browser Relay tokens, production CASE_FEED, or ONES credentials into GitHub issues or repository files.

## Resource model

Create only:

1. one private R2 bucket dedicated to staging transport;
2. one Worker using cloudflare-remote-gateway/src/index.mjs;
3. one TransportCoordinator Durable Object SQLite-backed namespace via the v1 migration;
4. two Worker secrets: BIGCIRCLE_HMAC_SECRET and WINDOWS_HMAC_SECRET.

The two role secrets must be independently generated high-entropy values. Do not reuse the Local Relay token or any Cloudflare API token.

## Config preparation

Copy cloudflare-remote-gateway/deploy/wrangler.staging.example.toml to an operator-local staging config that is not committed, then replace only the private R2 bucket name and optional non-secret timing values.

Run:

    python cloudflare-remote-gateway/deploy/preflight.py --config <operator-local-staging-config>

A placeholder bucket name, plaintext role secret, missing Durable Object migration, or invalid binding blocks deployment.

## Deployment sequence

Operator actions, executed only from an authenticated Cloudflare environment:

    npx wrangler r2 bucket create <private-staging-bucket>
    npx wrangler secret put BIGCIRCLE_HMAC_SECRET --config <staging-config>
    npx wrangler secret put WINDOWS_HMAC_SECRET --config <staging-config>
    npx wrangler deploy --config <staging-config>

Use Cloudflare readback to capture the deployed Worker version / deployment identity. Do not copy secret values into evidence.

## Runtime acceptance

Run only the synthetic smoke:

    python cloudflare-remote-gateway/deploy/smoke.py --base-url https://<staging-worker-host> --bigcircle-secret-file <local-bigcircle-secret-file> --windows-secret-file <local-windows-secret-file>

Required output:

    CLOUDFLARE_STAGING_SYNTHETIC_SMOKE_PASS

Required semantics:

- synthetic CASE_FEED PUSH -> Windows CLAIM/ACK;
- exact envelope bytes preserved;
- synthetic RESULT and CHECKPOINT reverse PUSH -> Big-circle CLAIM/ACK;
- productionDataUsed=false;
- browserRelayUsed=false;
- onesMutationUsed=false.

## Stop conditions

Stop and classify rather than workaround if any of these occur:

- HMAC/replay/role boundary mismatch;
- raw SHA mismatch;
- envelope identity mismatch;
- R2 object/hash mismatch;
- Durable Object lease/ACK mismatch;
- deployed source cannot be mapped to exact repository SHA;
- unexpected production data appears;
- any Browser/Relay or ONES write path is invoked.

## Rollback

If deployment code is wrong but resource state is not corrupted, redeploy the previously accepted Worker version.

If staging state itself is invalid:

- stop clients;
- preserve non-secret diagnostic evidence;
- delete/recreate staging-only R2/DO resources only after explicit operator confirmation.

Never use production payloads to diagnose a staging contract failure.

## Promotion boundary

A successful P4i staging smoke proves the provider implementation can transport synthetic envelopes over the real Cloudflare boundary. It does not authorize production CASE_FEED or production ONES mutation.

Production payload enablement requires a separate exact runtime acceptance checkpoint.
