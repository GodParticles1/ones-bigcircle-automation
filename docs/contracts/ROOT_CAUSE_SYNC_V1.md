# Root Cause Synchronization Contract v1

Status: DESIGN_ACTIVE / PLANNER_IMPLEMENTATION_CANDIDATE

## Purpose

For a confirmed local case that maps to exactly one existing ONES ticket, prepare and eventually execute a bounded synchronization of confirmed root-cause information.

This contract does not authorize production mutation by itself.

## Population model

Local case scope and ONES inventory scope may differ.

- local attribution uses confirmed Big-circle `handlerPersons` as primary;
- only when handler is empty/unresolved, `dutyPersons` is used as fallback;
- duty and handler are not blindly unioned when a valid handler exists;
- ONES inventory may contain tickets for a broader configured multi-engineer population;
- ONES assignee name is a first-class ONES-side population field;
- configured person/alias mappings are runtime configuration and must not be hardcoded in public source;
- raw case-count equality is never a reconciliation gate.

Person name aligns populations but does not by itself prove case identity. Exact sourceTicketKey remains the strongest current identity signal.

Missing detection is directional: a confirmed local sourceTicketKey absent from the complete shared ONES inventory may be classified as `ONES_MISSING_CASE`. If the exact key exists under a different ONES person scope, the case is `PERSON_SCOPE_MISMATCH`, not missing.

## Local root-cause source

The local root-cause source is Big-circle `remarks`, not a new manual field.

Remarks may contain mixed content. Before write-plan generation, derive:
- `rootCauseText`;
- `rootCauseState = CONFIRMED | PROVISIONAL | ABSENT | CONFLICT`;
- `rootCauseEvidenceSummary`;
- `rootCauseSource = remarks`.

Only `CONFIRMED` is write-eligible.

Examples of non-confirmed semantics include symptom-only descriptions, "可能/怀疑/初步判断/当前判断/待确认", recovery actions without causal evidence, or multiple conflicting causes.

The original remarks text remains authoritative evidence and must not be overwritten by the derived fields.

## Eligibility

A root-cause write plan may be produced only when all are true:

- reconciliation result is exactly one identity `MATCHED` ONES ticket;
- configured person/alias mapping resolves the effective local person (handler primary, duty fallback) and ONES assignee to a compatible person scope;
- the local case has stable provenance and case identity;
- local root cause is non-empty;
- local root cause is explicitly confirmed;
- configured root-cause field identifier is present;
- current ONES field value was read successfully.

## Read-before-write planner boundary

The planner consumes an explicit read-only current-field snapshot. An unread, missing, duplicate, mismatched or non-`READ_VERIFIED` current-field row is **not** equivalent to a blank value.

The current-field snapshot must bind:
- the exact matched ONES task UUID;
- the runtime-configured root-cause field identifier;
- a read status;
- the current field value;
- capture provenance/time when available.

The planner also binds the exact `CASE_FEED_V1` bytes to reconciliation through `pipeline.casesRawSha256`, and binds root-cause extraction back to the feed by `localCaseId`, `sourceTicketKey` and exact `remarks` fidelity.

## Comparison semantics v1

For this first planner implementation, "equal" means deterministic normalized-exact equality only:

- normalize CRLF/CR line endings to LF;
- trim leading/trailing whitespace;
- preserve internal text, punctuation and case.

No fuzzy matching, token similarity, LLM semantic equivalence or domain inference is permitted in the automatic decision.

## Decision table

- verified current ONES field blank + confirmed local root cause -> `SET_CANDIDATE`
- verified current ONES field normalized-exact equal -> `NOOP`
- verified current ONES field non-empty and different -> `CONFLICT_REVIEW`
- person-scope mismatch, ambiguous/missing ticket, unconfirmed root cause, unreadable/missing/duplicate current-value evidence, provenance drift, missing field config -> `BLOCK`

No blind overwrite.

The current planner emits a report/plan only. It does not enqueue a Browser/Relay job and does not mutate ONES.

## Execution boundary

A future executor must:

1. bind the action to the exact matched ONES task UUID and local case provenance;
2. re-read the target field immediately before mutation;
3. abort on precondition drift;
4. perform one bounded native/browser-supported write;
5. read back the field after save;
6. emit an idempotent result/checkpoint.

No uncertain write is blindly retried.

## Public-safe configuration

Public source must not contain private tenant, project, department, user, task or field identifiers.

Field identity such as the root-cause field is runtime configuration.

## Explicit non-goals

- no automatic ONES create/import for missing tickets;
- no fuzzy title matching;
- no owner/status/project/priority/delete mutation;
- no browser Cookie/Authorization export;
- no production write until a separate runtime acceptance explicitly enables this capability.
