# Browser Bridge v0.4.2 public projection

This is a configuration-driven, read-only projection of the previously accepted internal browser inventory/relay lane.

Key properties:

- no private ONES origin in source;
- no team/project/issue-type/department identifiers in source;
- no historical bounded-acceptance ticket IDs;
- no ONES write UI or write handlers;
- exact ONES origin permission is requested at runtime from a user gesture;
- current capabilities are `RELAY_PING`, `ONES_INVENTORY_READ`, and bounded read-only `ONES_FIELD_READ`;
- first-time setup draft is preserved in `chrome.storage.session` across popup close/reopen;
- the transient setup draft is cleared after a successful `Save + grant origin`;
- a committed Relay token is never rehydrated into the popup DOM or rendered in status JSON.

`ONES_FIELD_READ` reads only runtime-configured `fieldNNN` values from exact requested task UUIDs and fails closed on missing/non-unique tasks, unsupported field value shapes, or partial completion.

The extension still relies on the user's already authenticated browser session. It does not export Cookie/Authorization/password material to the Relay.

Runtime acceptance of this public projection is still required before it supersedes the accepted internal executor.
