# Big-circle Per-Person Scheduled Task Template v1

Status: ACTIVE_TEMPLATE
Scope: one engineer / one isolated scheduled-task lane
Cadence: workdays 19:30
Runtime support envelope: local-case maintenance + read-only ONES reconciliation

## Parameters

Fill these values per person at runtime:

```text
TASK_KEY={{TASK_KEY}}
TARGET_PERSON={{TARGET_PERSON}}
TARGET_PERSON_ALIASES={{TARGET_PERSON_ALIASES}}
TABLE_PREFIX={{TABLE_PREFIX}}
INITIAL_SCAN_START={{INITIAL_SCAN_START}}
```

Public source must not hardcode real people or private ONES identifiers.

## Parameter meanings

- `TASK_KEY`: this person's scheduled-task identity. It is used to distinguish the task itself, its runtime state/checkpoints and later audit records. Keep it stable after the task is created. Recommended example: `bigcircle-zxd-daily`.
- `TARGET_PERSON`: the canonical display identity for the person this task manages. It defines the per-person scope used by weekly-table maintenance, case-feed `configuredPeopleScope`, and reconciliation filtering. Recommended value: the person's actual stable display name used by the current Big-circle/ONES workflow.
- `TARGET_PERSON_ALIASES`: optional equivalent names/legacy display names/user-name variants that should resolve to `TARGET_PERSON`. Use only confirmed aliases. Leave empty when there is no alias; do not use fuzzy matching.
- `TABLE_PREFIX`: the stable prefix used to name this person's natural-week tables. It is only a namespace/prefix, not a person-matching rule. Example: `ZXD` produces tables such as `ZXD260629-260705`.
- `INITIAL_SCAN_START`: the earliest time this person's task is allowed to scan when no `last_successful_scan_time` exists yet. Normally use the person's confirmed onboarding/start date or the agreed backfill boundary. After the first successful run, normal execution uses the saved checkpoint instead of this value.

Management notes:
- `TASK_KEY`, `TABLE_PREFIX`, scan checkpoint and reconciliation checkpoint must be unique per person.
- `TARGET_PERSON` / aliases define identity scope; `TABLE_PREFIX` does not.
- Changing `INITIAL_SCAN_START` after a checkpoint exists must not silently rewind the checkpoint.
- Changing `TARGET_PERSON` or aliases after production use should be treated as a controlled configuration change because it can change reconciliation population.

## Full scheduled-task prompt

```text
你现在执行「{{TASK_KEY}}」每日值班记录维护任务。

【参数】
TASK_KEY={{TASK_KEY}}
TARGET_PERSON={{TARGET_PERSON}}
TARGET_PERSON_ALIASES={{TARGET_PERSON_ALIASES}}
TABLE_PREFIX={{TABLE_PREFIX}}
INITIAL_SCAN_START={{INITIAL_SCAN_START}}

【调度与 checkpoint】
- 工作日 19:30 执行。
- 每个人必须使用独立 scan checkpoint 和独立 reconciliation checkpoint，禁止不同人员共用。
- 正常扫描窗口：last_successful_scan_time -> 当前实际运行时间。
- 首次执行且无 checkpoint：从 INITIAL_SCAN_START 开始。
- 为判断跨日延续和实际处理行为，可向前回看最近 48h 上下文；不得因此重复创建已有案例。
- 每周首次运行时，先对上一自然周做 FINAL_RECONCILIATION，再进入当前增量窗口。

【状态机 A：大圆周表维护】
SEARCH_COLLECTED
-> SEARCH_PARSED
-> CASES_CLUSTERED
-> WRITE_VERIFIED
-> SCAN_COMPLETE

【状态机 B：ONES 对账】
CASE_FEED_BUILD
-> ONES_INVENTORY_AVAILABILITY_GATE
-> PERSON_AWARE_RECONCILIATION_V021
-> MISSING_REPORT
-> RECONCILIATION_CHECKPOINT

两个状态机独立。
只有 SCAN_COMPLETE 可以推进 last_successful_scan_time。
ONES WAIT/BLOCK 不得回滚大圆扫描、周表写入或 scan checkpoint。

==================================================
1. SEARCH_COLLECTED
==================================================

收集扫描窗口内与 TARGET_PERSON 有关的真实问题处理上下文。

可参考：
- 值班人；
- 处理人；
- 群聊中的明确技术处理行为；
- 已存在周表中的同问题延续记录。

不得因为仅被 @、普通讨论、围观、无实质处理而创建案例。

人员字段：
- 优先 userName；
- userName 不可用时回退 userid。

输出：
SEARCH_COLLECTED
SCAN_WINDOW_FROM
SCAN_WINDOW_TO
LOOKBACK_FROM

==================================================
2. SEARCH_PARSED
==================================================

把消息解析为：
- 新问题；
- 已有问题后续；
- 非问题聊天；
- 重复搜索结果；
- 仅引用旧问题无新增处理；
- 无法确认噪声。

不要凑数量。
不要创建 placeholder。

同一真实问题跨日持续：
- 优先更新已有案例；
- 不因日期变化重复新增；
- 只有证据证明独立新事件时才新建。

==================================================
3. CASES_CLUSTERED
==================================================

按自然周路由：
周一 -> 周日

周表名：
{{TABLE_PREFIX}}YYMMDD-YYMMDD

若不存在，按既有表结构创建。

【周表记录范围】
可以保留与 TARGET_PERSON 值班/处理上下文有关的真实案例。

【实际案例归属必须 handler-first】
1. handlerPersons 有有效人员：
   effectiveLocalPersons = handlerPersons
   attributionSource = HANDLER_PRIMARY

2. handlerPersons 为空/无法解析：
   effectiveLocalPersons = dutyPersons
   attributionSource = DUTY_FALLBACK

3. 两者都无法解析：
   attributionSource = PERSON_UNRESOLVED

4. handlerPersons 已存在时：
   不得把 dutyPersons union 进实际 owner 范围。

所以：
TARGET_PERSON 是值班人，但另一人是明确处理人，
该记录可保留在 TARGET_PERSON 的值班周表，
但个人处理案例统计/ONES 对账时不能算作 TARGET_PERSON 实际处理案例。

==================================================
4. WRITE_VERIFIED
==================================================

只维护以下 6 个业务字段：
1. 日期
2. 值班人
3. 处理人
4. 对接人
5. 群聊名称
6. 备注

其他已有字段：
- 不新增；
- 不清空；
- 不覆盖；
- 不改变字段类型。

【日期】
使用真实案例日期。

【值班人】
写实际值班人。

【处理人】
写实际技术处理人。
有明确处理人时，不因 TARGET_PERSON 是值班人而把 TARGET_PERSON 同时写成处理人。

【对接人】
只写有证据的真实对接人员；无法确认可为空。

【群聊名称】
纯文本，不写链接。

【备注】
备注是根因/处理结果的本地事实来源。

优先记录：
- 根因；
- 解决方法；
- 处理结果。

根因未确认时使用：
- 现象：
- 当前判断：
- 已处理：
- 当前结果：
- 下一步：

禁止：
- 把“可能/怀疑/初步判断/当前判断/待确认”升级为最终根因；
- 虚构根因；
- 用“已恢复”代替根因；
- 覆盖已有更完整备注。

仅有“重启，自己恢复”等极短且无充分技术信息的内容：
保留证据，但标记 INCOMPLETE，不升级为 confirmed real case。

写入后必须回读验证。
全部目标写入验证通过才可 WRITE_VERIFIED=true。

==================================================
5. SCAN_COMPLETE
==================================================

只有：
SEARCH_COLLECTED=true
SEARCH_PARSED=true
CASES_CLUSTERED=true
WRITE_VERIFIED=true

才允许：
SCAN_COMPLETE=true
last_successful_scan_time=当前实际运行时间

任一阶段失败：
SCAN_COMPLETE=false
不得推进 last_successful_scan_time。

后续 ONES/Windows 不可用不得回滚 SCAN_COMPLETE。

==================================================
6. CASE_FEED_BUILD
==================================================

仅当 SCAN_COMPLETE=true 才执行。

数据源：
已维护好的 {{TABLE_PREFIX}} 周表。
不要为了 ONES 对账重新全量扫描企微。

Schema：
bigcircle.confirmed-case-export/v1alpha1

reconciliation baseline：
2026-06-01

cases[] 只允许 CONFIRMED_REAL_CASE。

不得进入 cases[]：
- EMPTY_PLACEHOLDER
- CHECKPOINT_MARKER
- INCOMPLETE
- INCOMPLETE_CASE
- 其他控制/占位/检查点行

每条 case：
localCaseId
sourceTable
date
dutyPersons
handlerPersons
contactPersons
groupChatName
localReferenceKey
sourceTicketKey
summary
remarks
caseStatus=CONFIRMED_REAL_CASE

localCaseId 必须稳定，推荐：
sourceTable__recordId

remarks：
保持周表原文，不改写、不丢失。

summary：
必须非空；
可取备注首行或群聊名稳定摘要；
不得替代 remarks。

【localReferenceKey】
可保存本地引用编号：
INC...
CST...
纯数字编号
X-xx-xxxxxx
及其他本地稳定编号。

localReferenceKey != ONES external sourceTicketKey。

【sourceTicketKey】
优先：
已有可信 sourceTicketKey -> 规范化使用。

否则扫描完整 groupChatName。

ASCII token 边界：
[A-Z0-9-]

中文、中文标点、括号、空格均可作为边界。

合法候选：
^[A-Z][A-Z0-9]*-[0-9]+$

要求：
- 单连字符；
- 末尾数字；
- prefix 至少一个 ASCII 字母。

排除：
YF-[0-9]+

扫描全部 token 后：
- 唯一 1 个合法候选 -> sourceTicketKey
- 0 个 -> null
- >=2 个 -> null + ambiguous derivation

禁止：
- 按顺序猜；
- 按标题相似度猜；
- 按人名猜；
- 用当前 ONES inventory 反推出本地 key。

【人员范围】
configuredPeopleScope=[TARGET_PERSON]
people=configuredPeopleScope

【顶层 envelope】
schema
generatedAt
scanWindow
sourceTables
sourceTableCount
exportedCaseCount
complete
configuredPeopleScope
people
stableInputIdentifier
cases

【nested metadata】
complete
exportedCaseCount
sourceTables
sourceTableCount
missingKeyCount
incompleteCaseCount
localReferenceKeyCount
sourceTicketKeyCount

complete=true 前必须验证：
- 标准周表完整枚举，包括 0 行周；
- 控制/INCOMPLETE 行未进入 cases[]；
- cases[] 全是 CONFIRMED_REAL_CASE；
- remarks 保真；
- sourceTicketKey 按确定性规则；
- exportedCaseCount == len(cases)；
- sourceTableCount == len(sourceTables)；
- people == configuredPeopleScope；
- nested metadata 与顶层一致。

禁止硬编码任何历史 cases/inventory/matched/missing 数量。

==================================================
7. ONES_INVENTORY_AVAILABILITY_GATE
==================================================

当前 Big-circle <-> Windows 自动 transport 尚未验收。

Big-circle 不得：
- 直接访问 Windows 127.0.0.1；
- 获取浏览器 Cookie/Authorization/password/Relay token。

只有存在本次可消费的 fresh completeness-verified inventory 时才继续。

Schema：
ones.external-ticket-inventory/v1alpha1

必须：
status=INVENTORY_VERIFIED
inventoryComplete=true
reconciliationAllowed=true
ticketCount == serverTotalCount
ticketCount == visiblePageTotal
ticketCount == len(tickets)

不满足时：
RECONCILIATION_STATE=RECONCILE_WAIT_LOCAL_INVENTORY
或 RECONCILIATION_BLOCKED

停止本次 reconciliation lane。

必须保持：
- SCAN_COMPLETE；
- last_successful_scan_time；
- 已写周表；
- 上一次 verified reconciliation report/checkpoint。

==================================================
8. PERSON_AWARE_RECONCILIATION_V021
==================================================

只有 fresh verified inventory PASS 才执行。

本地 owner：
handlerPersons primary
dutyPersons fallback only

ONES owner：
assignee

identity：
exact normalized sourceTicketKey

结果：

MATCHED
= exact key 唯一存在
+ ONES assignee 与 effectiveLocalPersons 匹配

ONES_MISSING_CASE
= 本地有确定性 sourceTicketKey
+ 完整 ONES inventory 中不存在

PERSON_SCOPE_MISMATCH
= exact key 存在
+ ONES assignee 与 effectiveLocalPersons 不匹配
这不是缺单。

AMBIGUOUS
= sourceTicketKey 空、人员无法解析、assignee 无法解析、重复 key、多候选或其他非唯一情况。

禁止 fuzzy title matching。
禁止用“大圆总数 - ONES 总数”判断缺单。

==================================================
9. MISSING_REPORT
==================================================

只从 ONES_MISSING_CASE 生成补单候选。

按 sourceTicketKey 去重。

至少保留：
sourceTicketKey
localCaseIds
sourceTables
caseDates
groupChatNames
effectiveLocalPersons
summaries

当前仅人工交给问题处理组/现场补录。
不得自动创建 ONES 工单。

PERSON_SCOPE_MISMATCH：
单独 review 报告，不混进 missing。

AMBIGUOUS：
保留 reason/provenance，不猜 missing。

==================================================
10. RECONCILIATION_CHECKPOINT
==================================================

scan checkpoint 与 reconciliation checkpoint 独立。

新 exact input pair 成功：
RECONCILIATION_VERIFIED

以后再次收到完全相同：
case-feed bytes/hash
+ inventory bytes/hash
+ config

返回：
RECONCILIATION_NOOP_VERIFIED

正常每日任务不需要故意重复执行第二次。
NOOP 是幂等保证。

WAIT/BLOCK：
不推进 reconciliation checkpoint；
不覆盖上一次 verified report/checkpoint。

==================================================
11. 当前 ONES WRITE 边界
==================================================

当前任务只允许：
- 周表维护；
- case feed；
- read-only reconciliation；
- missing/mismatch/ambiguous 报告。

remarks 中已有根因/处理/结果，
后续由独立 root-cause extraction lane 结构化。

当前禁止：
- 自动 ONES create/import；
- 自动写根因；
- owner/status/project/priority/delete 修改；
- 任意 ONES mutation；
- Remote Queue；
- 导出浏览器凭据；
- fuzzy matching。

==================================================
12. 每次最终回报
==================================================

TASK_KEY=
TARGET_PERSON=
RUN_AT=

SCAN_WINDOW_FROM=
SCAN_WINDOW_TO=
LAST_SUCCESSFUL_SCAN_TIME_BEFORE=
LAST_SUCCESSFUL_SCAN_TIME_AFTER=

SEARCH_COLLECTED=
SEARCH_PARSED=
CASES_CLUSTERED=
WRITE_VERIFIED=
SCAN_COMPLETE=

WEEKLY_TABLES_TOUCHED=
NEW_CASE_COUNT=
UPDATED_CASE_COUNT=
DUPLICATE_SUPPRESSED_COUNT=
INCOMPLETE_CASE_COUNT=

CASE_FEED_BUILD=
CASE_FEED_FILE=
CASE_FEED_SHA256=
EXPORTED_CONFIRMED_CASE_COUNT=
EXTERNAL_SOURCE_TICKET_KEY_COUNT=
SOURCE_TICKET_KEY_NULL_COUNT=

ONES_INVENTORY_STATE=
ONES_INVENTORY_CAPTURED_AT=
ONES_TICKET_COUNT=

RECONCILIATION_STATE=
MATCHED_COUNT=
ONES_MISSING_CASE_COUNT=
PERSON_SCOPE_MISMATCH_COUNT=
AMBIGUOUS_COUNT=
UNIQUE_MISSING_SOURCE_TICKET_KEY_COUNT=

SCAN_CHECKPOINT_PRESERVED=
RECONCILIATION_CHECKPOINT=
PREVIOUS_VERIFIED_RECONCILIATION_PRESERVED=

【多人员一致性要求】
不同人员的任务只替换：
TASK_KEY
TARGET_PERSON
TARGET_PERSON_ALIASES
TABLE_PREFIX
INITIAL_SCAN_START

其余：
流程、状态名、字段语义、CASE_FEED、inventory gate、reconciliation、安全边界
保持一致。
```

## Management rule

For multiple engineers:
- duplicate this template once per person;
- each task gets an independent task key, table prefix, scan checkpoint and reconciliation checkpoint;
- only the parameter block changes;
- all other semantics remain identical.
