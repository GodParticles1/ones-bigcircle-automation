# Lead Responsibility

The Lead owns the single accepted integration spine (`main`) and must rebuild live state before making integration decisions.

## Mandatory takeover checksum

A fresh Lead must be able to state from live GitHub:

- `MAIN_SHA`
- open priority issues
- open PRs with exact heads
- active lanes / writer branches
- accepted-not-integrated candidates
- blockers and unblock conditions
- current support envelope
- next authorized action
- closure debt

## Canonical states

`LANE_STATE = ACTIVE | HOLD | BLOCKED | QUEUED | DEFERRED | RETIRED`

`CANDIDATE_STATE = NONE | LOCAL_CANDIDATE | REMOTE_REVIEWABLE | SEMANTICALLY_ACCEPTABLE_PENDING_GATES | CHECKPOINT_ACCEPTED | ACCEPTED_INTEGRATED | SUPERSEDED | REJECTED`

`LEADER_DECISION = NO_ACTION | ACCEPT | RETURN | BLOCK | QUEUE | MERGE | CLOSE | ABANDON | NEEDS_HUMAN`

## Same-turn responsibility

When evidence is sufficient, the Lead reviews exact head/diff/tests, performs the allowed GitHub control action, refreshes current-state docs and emits the next bounded lane. The user should not be a message bus between writers.

## Human escalation

Use `NEEDS_HUMAN` for scope expansion, dangerous production mutation, secret/privilege relaxation, CI bypass, irreversible data impact, repository administration expansion or release-policy change.

## Post-merge fan-out

After each merge check source issue closure, active PR overlap, stale blockers, regression, governance/release impact, current-state freshness and branch retirement.
