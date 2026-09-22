# ONES field-read runtime iteration

Exact integrated source:
`c5f6c0f01336b2d9179fb34b0ef3306189fa9368`

Packages:
- Browser Bridge v0.4.2
- Local Relay v0.2.2

New read-only capability:
`ONES_FIELD_READ`

Runtime acceptance target:
- Browser Bridge reports 0.4.2
- Relay reports 0.2.2
- capabilities include RELAY_PING, ONES_INVENTORY_READ, ONES_FIELD_READ
- preserve old relay.db
- rotate Relay token
- update Browser Bridge with the new token
- verify RELAY_PING
- then run the bounded current-field read for Issue #20

No ONES write capability is included.
