# Windows 全新安装：从这里开始

本包是 Issue #108 的安装候选包，组件为 **Browser Bridge 0.5.17、Local Relay 0.3.8、Planner 0.2.0**。`OPERATOR_RELEASE=HOLD_WRITER_FIX`。Issue #103 的原生输入缺陷仍被阻塞；本包没有 0.5.18 修复，也没有生产发布或写入授权。#103 经独立接受后，最终操作包必须针对接受的确切候选重新构建和验证。

所有步骤从空机器开始：没有旧扩展、数据库、token、任务 ID、CASE_FEED、reconciliation 或 planner 输出。不要从聊天、旧日志或旧阻塞父任务恢复 ID，不要导入历史 job JSON。安装包不包含任何生产配置或秘密。

## 1. 取得并核对安装包

从 Leader 的确切候选交付取得：

`ones-root-cause-fresh-install-v0.1.0-b0.5.17-r0.3.8-p0.2.0.zip`

以及同名 `.sha256`。用独立可信的交付报告核对 ZIP 的 SHA256；仅与随 ZIP 一同替换的校验文件相符不能证明来源可信。

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\ones-root-cause-fresh-install-v0.1.0-b0.5.17-r0.3.8-p0.2.0.zip'
```

确认相符后，用 Windows“全部解压缩”到当前用户可写的新目录。不要在 ZIP 内直接运行，不要覆盖已有安装目录。下文在解压后含 `Install.ps1` 的目录打开 **Windows PowerShell**。示例无需管理员、Git、`D:\tools` 或已有注册表配置。

包内 `BUNDLE-MANIFEST.json` 记录各文件 SHA256 和源码 HEAD，`VERSION.json` 记录组件版本。预检会核对包内文件；任何缺失、改动或版本不符都停止。具体 HEAD、ZIP SHA256 和 Linux/Windows CI 结果以此次候选交付报告为准；CI 通过不等于生产或真实编辑器接受。

## 2. 准备第三方依赖

先读 [PREREQUISITES.md](PREREQUISITES.md)，按官方来源和离线核验步骤准备 Windows PowerShell 5.1 或更高、Python 3.12 或更高（内置 SQLite 3.24 或更高）、Chrome 102 或更高。Chrome 应使用仍获厂商支持的稳定版；102 只是冻结代码所用 API 的最低界限。安装包不会下载或捆绑第三方安装器，不需要 `pip install`。

若企业策略禁止 PowerShell 脚本或 unpacked Chrome 扩展，停止并交由环境负责人提供允许的执行方式；不要更改全局安全策略。

## 3. 预检和安装

在解压目录执行：

```powershell
.\Preflight.ps1
.\Install.ps1
```

预检会执行实际 Python/SQLite 检查并检查 Chrome 文件版本。自动发现失败时，提供已核验的实际可执行文件绝对路径：

```powershell
.\Preflight.ps1 -PythonPath 'C:\approved\Python\python.exe' -ChromePath 'C:\approved\Chrome\chrome.exe'
.\Install.ps1 -PythonPath 'C:\approved\Python\python.exe' -ChromePath 'C:\approved\Chrome\chrome.exe'
```

上面的路径仅为占位符。不要把 Microsoft Store 的未安装 Python 别名当作解释器。

默认安装根目录为 `%LOCALAPPDATA%\ONES\root-cause-fresh-install-v0.1.0`，默认端口为 `18731`。也可在首次安装时显式指定：

```powershell
.\Install.ps1 -InstallRoot 'C:\approved\ONES-fresh' -Port 18731
```

安装复制经过校验的组件并创建 `installation.json`、`data` 和 `output` 目录。此时不会生成 token/数据库，不会登录、授权 ONES、运行浏览器、创建计划任务或 enqueue 作业。相同包、相同配置的重复安装应保留原数据；目标非空且身份/配置不符时停止，不强制覆盖。

## 4. 首次启动 Relay

使用步骤 3 确定的根目录；默认路径示例：

```powershell
$installRoot = Join-Path $env:LOCALAPPDATA 'ONES\root-cause-fresh-install-v0.1.0'
& (Join-Path $installRoot 'Start.ps1')
```

首次正常启动 Relay 生成新的 `data\relay-token.txt` 和空的 `data\relay.db`，`data\process.json` 保存本安装的进程归属。预期输出 `START=PASS`、`PID`、`LOOPBACK_URL` 和 `TOKEN_FILE` 路径；不会打印 token。监听地址必须是 `127.0.0.1`，不能改为局域网或远程入口。再次启动已核实属于本安装的进程应返回 `START=ALREADY_RUNNING`。

遇到端口冲突时，脚本停止，不能杀掉占用进程。可本地查看占用者，再由其负责人处理，或为一个新的安装根目录选另一端口：

```powershell
Get-NetTCPConnection -LocalPort 18731 -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess
```

版本、进程归属、token、健康检查或数据状态异常均先停止诊断。不要删除数据库、反复重新 enqueue 或用旧 token 绕过检查。

## 5. 手动加载 Browser Bridge

打开 Chrome 的 `chrome://extensions`，启用“开发者模式”，选择“加载已解压的扩展程序”，目录选：

`<installRoot>\components\browser-bridge`

确认显示版本 **0.5.17**，仅加载这一份扩展。安装路径应保持稳定，不要从临时解压目录加载。若已有其他 Bridge，先停止该扩展的轮询，避免多个 executor 同时连接；不要复用其历史状态。

## 6. 手动配置非生产验收环境

本 lane 的运行验证限于 **Leader 授权的非生产/合成环境**。没有可用验收环境时标记 `BLOCKED`，不要改用生产环境。由操作人手动登录指定 ONES 环境，保留唯一一个符合配置 scope 的 ONES 标签页。

打开扩展 popup，填写该环境的 `ONES origin`（仅 HTTPS scheme + host + 可选端口）、`Team UUID`、`Project UUID`、`Issue type UUID`、`Department UUID` 和 `Root-cause field UUID`。UUID 从可信配置和页面身份取得，不按标题相似度猜测。填写步骤 4 的 loopback Relay URL。

通过本地文本编辑器打开步骤 4 输出的 `TOKEN_FILE`，把新 token 手动填入 popup 的 `Relay token`；不要把 token、cookie、登录信息、真实 UUID 或截图发到 Issue/PR。设置：

- 勾选 `Enable background polling`。
- **保持 `Enable production root-cause write gate` 不勾选**。
- 点击 `Save + grant origin`，仅授权手动填写的验收 origin。

popup 重新打开后 token 输入框可能为空；以 `tokenPresent: true` 判断保存状态，不把空展示误认为丢失 token。核对 `writeEnabled: false`，能力只有 `RELAY_PING`、`ONES_INVENTORY_READ`、`ONES_FIELD_READ`。缺 scope 或权限时先修正本地配置，不扩大环境访问。

## 7. Relay TEST、Poll 和新鲜 heartbeat

在 popup 点击 `Test Relay`，确认健康版本 **0.3.8**；点击 `Poll now` 发送当前 executor heartbeat。随后运行：

```powershell
& (Join-Path $installRoot 'Verify-ReadOnly.ps1') -Mode Status
```

Status 不 enqueue；它核对 Relay 归属/健康、唯一且新鲜的 executor、扩展版本 0.5.17、上述三项精确只读能力和 `onesTabCount=1`。它必须拒绝任何写入/格式修复能力。未出现新鲜 heartbeat、多个 executor、多个 ONES 标签页、错误 token 或版本不符都停止。不要把旧 heartbeat 当本次握手。

## 8. 本次唯一 Ping

```powershell
& (Join-Path $installRoot 'Verify-ReadOnly.ps1') -Mode Ping
```

此操作才生成本次新的 Ping job ID 和 nonce，并等待当前唯一 executor 处理。脚本核对 job ID、executor、精确 payload 回显及本次时间边界。只读成功才继续；超时或不确定结果不是 PASS。默认等待 45 秒，必要时显式传 `-TimeoutSeconds`。禁止以旧作业成功状态替代本次结果。

## 9. 单一任务/字段只读验收，然后 STOP

从已授权的验收配置取得准确任务 UUID 和字段 UUID，在本地变量中输入：

```powershell
$taskUuid = Read-Host '本次验收任务 UUID'
$fieldId = Read-Host '已配置 root-cause 字段 UUID'
& (Join-Path $installRoot 'Verify-ReadOnly.ps1') -Mode Field -TaskUuid $taskUuid -FieldId $fieldId
```

需要验证预期非空值时，手动提供合成的预期值：

```powershell
$expectedValue = Read-Host '本次合成预期值'
& (Join-Path $installRoot 'Verify-ReadOnly.ps1') -Mode Field -TaskUuid $taskUuid -FieldId $fieldId -ExpectedValue $expectedValue
```

脚本只 enqueue 本次单一 `ONES_FIELD_READ`，要求新 job ID、唯一 executor、准确 task/field、`readOnly=true`、`complete=true`、`READ_VERIFIED` 和本次新鲜时间。缺失/失败读数不视为空白。字段内容不在终端打印；分类为：

| 结果 | 含义和下一步 |
| --- | --- |
| `BLANK` | 准确字段经只读验证为空；停止在只读屏障，不能据此写入。 |
| `EQUAL` | 与明确提供的预期值按冻结的标准化精确比较相等；停止。 |
| `CONFLICT` | 非空且不同，或未提供预期值的非空字段；保留证据交由人工处理，停止。 |

保存的本地快照路径通过 `FIELD_READ_FILE` 输出，为 `output\field-read-<newJobId>.json`；`JOB_ID` 是本次任务身份。快照可能包含私有字段内容，不能提交公共仓库。不要重用旧 job、旧父任务或历史快照来通过 gate。

**到这里 STOP。** 不启用写入开关，不执行写入/格式修复 helper，不创建生产父任务，不自动 enqueue。即使以上结果 PASS，`OPERATOR_RELEASE` 仍为 `HOLD_WRITER_FIX`。

## 10. 可选：运行执行自由的 Planner

本包保留原 Planner，只生成计划。它不抓取 CASE_FEED、不自动恢复 reconciliation、也不调用 Relay 写入。需要另行取得可信的 exact `CASE_FEED_V1`、绑定其 SHA256 的 reconciliation 报告，以及步骤 9 保存的完整、新鲜只读快照。缺任何输入时停止；不能制造空文件、复用历史数目或补造任务 ID。

在本地准备输入路径并核对各 SHA256；字段快照必须在运行时仍新鲜（不超过 120 秒）：

```powershell
& (Join-Path $installRoot 'Run-Planner.ps1') -Cases $casesPath -Reconciliation $reconciliationPath -FieldReads $fieldReadsPath -FieldId $fieldId -CasesSha256 $casesSha256 -ReconciliationSha256 $reconciliationSha256 -FieldReadsSha256 $fieldReadsSha256
```

这些变量必须来自本次可信文件和独立核验，不能从示例复制。输出计划不是写入授权；继续停留在只读屏障。Big-circle 传输、周期 reconciliation、Windows 计划任务及未明确需要的旧中间件不属于本次恢复范围。

## 候选交付证据

Leader 评审前应核对确切 HEAD 的 Linux/Windows CI 和 ZIP SHA256。Linux 只承担可移植的静态结构、版本、manifest 与安全边界检查；Windows 合成回归承担空目录安装、第二次运行、启停重启、错误 token、无 Python、无 Chrome、已有 DB 保留和端口冲突。合成 executor 的只读证据不等于真实 Chrome/ONES 验收；未执行的真实环境步骤必须报告 `NOT_RUN` 或 `BLOCKED`，不从 CI 推导 PASS。

## 停止、重启、回退和卸载

```powershell
& (Join-Path $installRoot 'Stop.ps1')
& (Join-Path $installRoot 'Start.ps1')
```

Stop 仅停止同时匹配本安装 PID、Relay 路径、数据目录和端口的进程；身份不确定或端口属于他人时停止并报告。Stop 保留 token、数据库和 output，重启复用本安装自己的状态。重启后重新执行 Status/Ping；需要字段证据时创建新的 Field 读。

回退：先在 popup 关闭 background polling，保持写入开关关闭；运行 Stop，再在 `chrome://extensions` 禁用本扩展。保留整个安装根目录及确切包/hash，供本地审计。不要把新数据库迁移回旧故障包，不启动旧阻塞父任务；替换候选需 Leader 的独立批准和新安装根目录。

卸载：完成上述停止和扩展移除即停用。手动整理已确认属于本安装的文件前，先保存必要的 `data` 和 `output` 到受控本地位置；安装/停止脚本不会删除历史。第三方 Python/Chrome 可能供其他软件使用，不由本包卸载。请勿把 token、数据库、原始输入或私有日志附到公开交付报告。
