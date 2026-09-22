# ONES Big-circle Windows Local Agent v0.1.1

This is the corrected provider-neutral Windows package.

It intentionally does NOT require:
- Cloudflare API key;
- remote BaseUrl;
- remote HMAC secret;
- HTTPS transport;
- any ONES write capability.

It consolidates the already-accepted local periodic alignment code so the old code directory `ones-periodic-alignment-v1` can be retired after Task Scheduler is repointed.

Default local paths:
- Case feed search root: D:\tools
- Relay: D:\tools\ones-local-relay-v0.2.1
- Reconciliation: D:\tools\ones-bigcircle-reconciliation-v0.2.1
- Runtime state: D:\tools\periodic-alignment-runtime

Install:
1. Extract to D:\tools\ones-bigcircle-windows-agent-v0.1.1
2. Run setup.ps1
3. Run show-status.ps1
4. Run run-once.ps1

The existing Local Relay token/relay.db and Browser Bridge configuration are not moved or changed by this package.
