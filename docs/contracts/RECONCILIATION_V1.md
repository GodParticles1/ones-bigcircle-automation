# Reconciliation Contract v1

Inputs:

- confirmed local case feed;
- completeness-verified ONES external-ticket inventory.

Primary match key: exact normalized `sourceTicketKey`.

Output classes:

- `MATCHED`: exactly one ONES ticket has the same key;
- `ONES_MISSING_CASE`: confirmed local case has an external-ticket-format key and verified inventory has no match;
- `AMBIGUOUS`: missing/malformed key, duplicate inventory key, display-ID/local-only identifier, truncated provenance or other non-unique condition.

No fuzzy title matching. Missing ONES does not invalidate the local case. Actionable missing report is deduplicated by `sourceTicketKey` while preserving row-level local provenance.
