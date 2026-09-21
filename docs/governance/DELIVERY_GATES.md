# Delivery Gates

## Exact evidence

Acceptance binds to exact source SHA, exact artifact hash where applicable, actual executed tests and the support environment.

## Public privacy gate

Before merge to this public repository, confirm:

- synthetic fixtures only;
- no real engineer names/person IDs;
- no production case/chat exports;
- no private ONES origin/tenant identifiers;
- no credentials, cookies, Authorization headers or relay token files;
- no raw internal screenshots/log bundles.

## Reconciliation gate

Missing-ticket declarations require a completeness-verified inventory. No fuzzy title matching. Exact reruns must be idempotent.

## Relay gate

Relay is loopback-only by default, uses local token auth, persists jobs, never stores ONES browser credentials and never blindly requeues a claimed job.

## Browser gate

Public browser source must be configuration-driven and must not embed private tenant/origin identifiers. Current read-only capabilities must remain distinct from future write lanes.

## Failure classification

Use: `PRODUCT_DEFECT`, `TEST_DEFECT`, `HARNESS_DEFECT`, `RUNNER_INFRA_UNAVAILABLE`, `PERMISSION_PLAN_BLOCKED`, `UNRESOLVED`.
