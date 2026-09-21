# Root Cause Synchronization Contract v1

Status: DESIGN_QUEUED

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

## Eligibility

A root-cause write plan may be produced only when all are true:

- reconciliation result is exactly one identity `MATCHED` ONES ticket;
- configured person/alias mapping resolves the effective local person (handler primary, duty fallback) and ONES assignee to a compatible person scope;
- the local case has stable provenance and case identity;
- local root cause is non-empty;
- local root cause is explicitly confirmed;
- configured root-cause field identifier is present;
- current ONES field value was read successfully.

## Decision table

- current ONES field blank + confirmed local root cause -> `SET_CANDIDATE`
- current ONES field semantically equal -> `NOOP`
- current ONES field non-empty and different -> `CONFLICT_REVIEW`
- person-scope mismatch, ambiguous/missing ticket, unconfirmed root cause, unreadable current value, missing field config -> `BLOCK`

No blind overwrite.

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
