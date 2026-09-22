# ONES root-cause planner runtime v0.2.0

Execution-free planner runtime with unique ONES-task target projection.

Future write gates must use `taskTargets[]`, not case-level `cases[]`.
Multiple distinct confirmed local root causes for one ONES task fail closed as `LOCAL_ROOT_CAUSE_MULTI_CASE_CONFLICT`.

No ONES mutation capability is included.
