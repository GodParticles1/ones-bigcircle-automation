# AGENTS.md — permanent repository constraints

This is the permanent startup entry for `GodParticles1/ones-bigcircle-automation`.

## Startup order

1. Read this file.
2. Read `docs/context/CURRENT.md`.
3. Reconstruct live `main`, open priority issues, open PRs, writer branches, exact heads and CI.
4. Read `TASKS.md` and `HANDOFF.md`.
5. Read only the product/security contracts relevant to the current lane.
6. If acting as Lead, read `docs/governance/LEAD_RESPONSIBILITY.md`.

Chat summaries and old handoffs are recovery aids, not live authority.

## Authority

`latest explicit user instruction > live repository/runtime evidence > accepted/frozen decisions > governance contracts > current-state snapshots > historical notes`

## Product boundary

This repository owns automation code and contracts for:

- local confirmed-case feed normalization;
- completeness-verified ONES inventory reconciliation;
- local loopback relay;
- a future public-safe, configuration-driven browser bridge;
- future transport only after a separate accepted contract.

It does not own xRocket product knowledge. It must not become a second history/memory repository.

## Public repository privacy boundary

Never commit:

- real engineer names or personal identifiers;
- production case exports or raw group-chat history;
- private ONES origins, tenant/team/project/department identifiers;
- cookies, Authorization headers, passwords, tokens, private keys or session material;
- exact production screenshots/log bundles unless separately reviewed and redacted.

Use synthetic fixtures and configuration placeholders in public code/tests/docs.

## Safety boundary

Current capabilities are read-only with respect to ONES. Do not enable create/import or field mutation without a separately frozen contract and runtime acceptance.

Never export browser credentials to the relay or cloud. The relay stays loopback-only by default.

Incomplete inventory cannot declare missing tickets. Ambiguous local keys are not guessed by title similarity.

## Engineering

Prefer small explicit modules, deterministic schemas, fail-closed validation, idempotency and atomic checkpoint updates. No hidden retries for uncertain delivery. Tests bind to the exact candidate SHA.

## Multi-agent

Each writer gets an accepted base SHA, branch, bounded goal, owned files, required tests and stop conditions. Writers do not self-merge or expand product scope. Lead owns semantic review and integration.

## Persistence

Permanent rules live here/governance. Current facts live in `docs/context/CURRENT.md`. Active gates live in `TASKS.md`. Executable continuation lives in `HANDOFF.md`. Do not create a second global memory system inside this repository.
