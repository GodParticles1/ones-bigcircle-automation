# ONES Big-circle Windows Remote Agent v0.1.0

First installable Windows iteration for the accepted Big-circle <-> Windows remote transport spine.

## Existing prerequisites

- Python 3.12 available as `python`;
- Local Relay v0.2.1 already accepted/running;
- Browser Bridge already connected to that Relay;
- reconciliation v0.2.1 already present;
- Cloudflare transport Worker HTTPS endpoint;
- Windows role HMAC secret stored in a local file.

## Install

1. Extract this ZIP to `D:\tools\ones-bigcircle-windows-agent-v0.1.0`.
2. Run `setup.ps1` once.
3. Edit `config.ps1` and set only your Worker BaseUrl / paths if your paths differ.
4. Put the Windows transport HMAC secret in `data\windows-hmac-secret.txt`.
5. Run `show-status.ps1`.
6. Run `run-once.ps1`.

`run-once.ps1` performs:

Big-circle remote CASE_FEED -> Cloudflare -> local spool -> exact CASE_FEED materialization -> existing Relay/Browser inventory read -> reconciliation -> RESULT/CHECKPOINT -> Cloudflare.

No ONES write operation is enabled by this package.

Do not place the Local Relay token in this package. Relay continues to own its existing token/data/relay.db separately.
