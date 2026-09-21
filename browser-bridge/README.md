# Browser Bridge v0.4.0 public projection

This is a configuration-driven, read-only projection of the previously accepted internal browser inventory/relay lane.

Key differences from the internal lineage:

- no private ONES origin in source;
- no team/project/issue-type/department identifiers in source;
- no historical bounded-acceptance ticket IDs;
- no ONES write UI or write handlers;
- exact ONES origin permission is requested at runtime from a user gesture;
- current capabilities remain `RELAY_PING` and `ONES_INVENTORY_READ`.

The extension still relies on the user's already authenticated browser session. It does not export Cookie/Authorization/password material to the Relay.

Runtime acceptance of this public projection is still required before it can supersede the accepted internal v0.3.36 executor.
