# Reconciliation Contract v1

Inputs:

- confirmed local case feed;
- completeness-verified ONES external-ticket inventory.

## Person attribution

ONES already has an explicit assignee/owner field. The local Big-circle feed has `handlerPersons` and `dutyPersons`.

For each local case, derive `effectiveLocalPersons` with strict precedence:

1. if `handlerPersons` contains one or more valid people, use `handlerPersons`;
2. only when `handlerPersons` is empty/unresolved, fall back to `dutyPersons`;
3. do not union duty people into the effective owner set when a valid handler is present.

Record the source as:

- `HANDLER_PRIMARY`;
- `DUTY_FALLBACK`;
- `PERSON_UNRESOLVED`.

This prevents a duty-shift person from being counted as the case owner when an actual handler is already known.

ONES-side person scope comes from the ticket assignee. Person names/aliases are runtime configuration; real names are never hardcoded in public source. When stable user IDs are available they may be mapped to the same configured person key.

## Identity and population matching

Primary case identity key: exact normalized `sourceTicketKey`.

Person fields align the population; they do not replace the case identity key.

For one local case:

1. derive its effective local person scope using handler-first/duty-fallback;
2. look up the exact `sourceTicketKey` in the completeness-verified shared ONES inventory;
3. classify the result using both identity and assignee scope.

Output classes:

- `MATCHED`: exactly one ONES ticket has the exact key and its assignee resolves to a compatible effective local person;
- `ONES_MISSING_CASE`: the exact external-ticket key is absent from the complete shared ONES inventory;
- `PERSON_SCOPE_MISMATCH`: the exact key exists, but the ONES assignee belongs to a different configured person scope;
- `AMBIGUOUS`: missing/malformed key, duplicate inventory key, unresolved/ambiguous person mapping, display-ID/local-only identifier, truncated provenance or another non-unique condition.

An exact key found under another person's ONES scope is not a missing ticket.

No fuzzy title matching. Missing ONES does not invalidate the local case. Actionable missing output is deduplicated by `sourceTicketKey` while preserving row-level local provenance, effective person and attribution source.
