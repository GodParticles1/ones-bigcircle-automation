# Control Plane profile

Adapter metadata only. All file references are repository-root-relative; the named native owners retain authority. This profile is not a second rulebook.

```json
{
  "controlPlaneVersion": "1",
  "enabled": true,
  "governanceEntrypoints": [
    "AGENTS.md",
    "docs/context/CURRENT.md",
    "TASKS.md",
    "HANDOFF.md",
    "docs/governance/LEAD_RESPONSIBILITY.md",
    "docs/governance/MULTI_AGENT.md",
    "docs/governance/DELIVERY_GATES.md",
    "issue:1"
  ],
  "reportMarkers": {
    "progress": "WRITER_PROGRESS:",
    "final": "WRITER_FINAL:",
    "blocked": "WRITER_BLOCKED:"
  },
  "executionObserved": {
    "authority": "docs/governance/MULTI_AGENT.md#execution-truth",
    "evidence": [
      "WRITER_PROGRESS",
      "WRITER_BRANCH_HEAD_DIFFERS_FROM_ACCEPTED_BASE",
      "NATIVE_DIRECT_EXECUTION_EVIDENCE"
    ]
  },
  "exactHeadCI": {
    "binding": "EXACT_CANDIDATE",
    "authority": [
      "docs/governance/LEAD_RESPONSIBILITY.md#evidence-and-completion",
      "docs/governance/DELIVERY_GATES.md#exact-evidence"
    ]
  },
  "humanGates": {
    "runtimeAcceptance": [
      "AGENTS.md",
      "docs/governance/LEAD_RESPONSIBILITY.md#evidence-and-completion"
    ],
    "productionMutation": [
      "AGENTS.md",
      "docs/governance/LEAD_RESPONSIBILITY.md#authority-inheritance-and-escalation"
    ]
  },
  "automation": {
    "OPERATING_MODE": "SEMI_AUTO",
    "MANUAL_WRITER_LAUNCH": "ENABLED",
    "MANUAL_RUNTIME_ACCEPTANCE": "ENABLED",
    "OPENAI_API_LAUNCHER": "RESERVED_DISABLED",
    "OPENAI_API_KEY_BINDING": "NO",
    "OPENAI_BILLING_EXPANSION": "NO",
    "GITHUB_BILLING_EXPANSION": "NO",
    "PAID_RUNNER_AUTOSCALE": "NO"
  }
}
```
