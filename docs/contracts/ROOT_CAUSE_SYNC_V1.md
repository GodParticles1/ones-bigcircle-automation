# Root Cause Synchronization Contract v1

Status: DESIGN_QUEUED

## Purpose

For a confirmed local case that maps to exactly one existing ONES ticket, prepare and eventually execute a bounded synchronization of confirmed root-cause information.

This contract does not authorize production mutation by itself.

## Population model

Local case scope and ONES inventory scope may differ.

- local attribution truth comes from the confirmed Big-circle case feed;
- ONES inventory may contain tickets for a broader configured multi-engineer population;
- ONES assignee is metadata, not the authority for local duty/handler attribution;
- raw case-count equality is never a reconciliation gate.

Missing detection is directional: a confirmed local sourceTicketKey absent from a completeness-verified shared ONES inventory may be classified as `ONES_MISSING_CASE`.

## Eligibility

A root-cause write plan may be produced only when all are true:

- reconciliation result is exactly one `MATCHED` ONES ticket;
- the local case has stable provenance and case identity;
- local root cause is non-empty;
- local root cause is explicitly confirmed;
- configured root-cause field identifier is present;
- current ONES field value was read successfully.

## Decision table

- current ONES field blank + confirmed local root cause -> `SET_CANDIDATE`
- current ONES field semantically equal -> `NOOP`
- current ONES field non-empty and different -> `CONFLICT_REVIEW`
- ambiguous/missing ticket, unconfirmed root cause, unreadable current value, missing field config -> `BLOCK`

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
