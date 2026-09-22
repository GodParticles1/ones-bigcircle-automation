# Transport envelope v1

This module is the first Gate D2 engineering slice.

It defines a provider-neutral envelope only. It does **not** choose or call a queue, network service, cloud provider, browser API, or ONES mutation endpoint.

Supported kinds:

- `CASE_FEED`
- `RESULT`
- `CHECKPOINT`

Supported directions:

- `BIGCIRCLE_TO_WINDOWS`
- `WINDOWS_TO_BIGCIRCLE`

The payload is canonical JSON bytes bound by SHA256 and carried as Base64. Envelope identity and idempotency key are deterministic from immutable routing metadata + payload hash, so later adapters can deduplicate/replay safely without reinterpreting business semantics.

Example:

```bash
python transport-envelope/envelope.py build \
  --payload case-feed.json \
  --direction BIGCIRCLE_TO_WINDOWS \
  --kind CASE_FEED \
  --producer bigcircle-control \
  --consumer windows-agent \
  --output envelope.json

python transport-envelope/envelope.py validate --input envelope.json
```

No provider-specific transport or production ONES write is implemented here.
