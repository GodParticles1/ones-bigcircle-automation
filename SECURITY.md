# Security

Do not report or commit real credentials, session cookies, Authorization headers, relay tokens, production case exports, private ONES origins/tenant identifiers, or personal identifiers.

The browser bridge must preserve credential locality: authenticated browser credentials remain inside the browser session and are not exported to the relay or remote control plane.

Current repository support is read-only with respect to ONES.
