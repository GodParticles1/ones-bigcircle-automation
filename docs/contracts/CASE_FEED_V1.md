# Big-circle Confirmed Case Feed Contract v1

Status: ACTIVE

Schema: `bigcircle.confirmed-case-export/v1alpha1`

## Purpose

Provide the exact local confirmed-case snapshot consumed by person-aware ONES reconciliation.

The feed is not a raw weekly-table dump. It must exclude control rows and preserve deterministic case identity, local person attribution, and original remarks.

## Row eligibility

Emit only confirmed real cases.

Never emit as a case:
- `EMPTY_PLACEHOLDER`
- `CHECKPOINT_MARKER`
- `INCOMPLETE` / `INCOMPLETE_CASE`
- any other control/checkpoint row

Rows excluded here do not become missing ONES cases.

## Local person attribution

For every emitted case:
1. valid `handlerPersons` present => effective owner source is `HANDLER_PRIMARY`;
2. otherwise use `dutyPersons` as `DUTY_FALLBACK`;
3. never union duty into ownership when handler exists.

The feed preserves both original arrays. Reconciliation derives the effective person again and applies configured people scope.

## sourceTicketKey deterministic extraction

Use this precedence:

1. If the maintained source row already has an explicit trusted `sourceTicketKey`, normalize and validate it.
2. Otherwise scan the full `groupChatName` for external-ticket candidates.
3. Candidate grammar:
   - contains at least one ASCII letter;
   - prefix segment is ASCII letters/digits;
   - exactly one hyphen before the final decimal sequence;
   - equivalent public-safe grammar: `^[A-Z0-9]+-[0-9]+$` with at least one letter;
   - `YF-[0-9]+` is excluded because it is an ONES display ID, not the external source key.
4. Token matching must use boundaries; a candidate embedded inside a longer ASCII letter/digit/hyphen token is invalid.
5. Exactly one unique valid candidate => use it.
6. Zero valid candidates => `sourceTicketKey=null`.
7. More than one unique valid candidate => `sourceTicketKey=null` and mark derivation ambiguous; never guess by order, title similarity or person name.

Examples that satisfy the current observed ONES inventory grammar:
- `W26050712-10`
- `Z26024313-12`
- `DWSJ2-102`
- `SHPD1-652`

Examples that must not be promoted by this contract:
- `160624`
- `INC2026063000019`
- `YF-12439`
- `X-26-049883` under the current one-hyphen grammar
- arbitrary fuzzy title fragments

This extractor is inventory-independent: it must still produce a valid local key when that key is absent from the current ONES inventory. That property is required for missing-ticket detection.

## Canonical case row

Each emitted case must contain:
- `localCaseId`
- `sourceTable`
- `date`
- `dutyPersons`
- `handlerPersons`
- `contactPersons`
- `groupChatName`
- `sourceTicketKey`
- `summary`
- `remarks`
- `caseStatus=CONFIRMED_REAL_CASE`

`localCaseId` must be stable across repeated exports of the same row. `sourceTable__recordId` is acceptable.

`remarks` preserves the maintained weekly-table text exactly.

`summary` must be non-null. It may be a stable concise projection from remarks/groupChatName, but it must not replace or alter remarks.

## Compatibility envelope

Until the public reconciler contract is intentionally versioned, emit both the public top-level envelope and the current compatibility fields.

Top level:
- `schema`
- `generatedAt`
- `scanWindow`
- `sourceTables`
- `sourceTableCount`
- `exportedCaseCount`
- `complete`
- `configuredPeopleScope`
- `stableInputIdentifier`
- `cases`

Compatibility:
- `people` = same value as `configuredPeopleScope`
- `metadata.complete`
- `metadata.exportedCaseCount`
- `metadata.sourceTables`
- `metadata.sourceTableCount`
- `metadata.missingKeyCount`

All count fields must equal the actual emitted canonical cases and table arrays.

## Fidelity gates

`complete=true` is allowed only when all are true:
- every requested standard week table is enumerated, including zero-row weeks;
- control/incomplete rows are excluded;
- every emitted row has `caseStatus=CONFIRMED_REAL_CASE`;
- remarks are faithfully preserved;
- sourceTicketKey derivation followed the deterministic rule;
- exportedCaseCount equals `len(cases)`;
- compatibility metadata matches the top-level envelope.

No fuzzy title matching.
No ONES lookup may be used to invent a missing local key.
