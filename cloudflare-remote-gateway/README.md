# Cloudflare remote gateway

Provider-side implementation for `CLOUDFLARE_WORKER_DO_R2_V1`.

It implements the frozen P4g contract using:
- Worker HTTPS gateway;
- Durable Object state for nonce replay, per-direction order, dedupe, leases and ACK;
- private R2 binding for exact envelope-file bytes.

This directory intentionally contains no real account IDs, bucket IDs, routes or secrets.

Use `wrangler.example.toml` only as a deployment template after a separate staging-deployment authorization/checkpoint.
