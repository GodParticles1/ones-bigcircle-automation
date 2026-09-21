# Local Relay Contract v1

Current supported job types:

- `RELAY_PING`
- `ONES_INVENTORY_READ`

Properties:

- bind loopback only;
- local token authentication;
- SQLite job persistence;
- idempotency key dedup;
- claimed jobs are not blindly requeued;
- errors-only bounded logging;
- no browser Cookie/Authorization/password storage;
- no Relay-triggered ONES write capability in the current support envelope.
