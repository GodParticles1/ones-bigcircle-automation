# 依赖与离线准备

安装包不含第三方二进制安装器，不静默下载、不使用 `pip`。先准备并核验依赖，再运行 `Preflight.ps1`；缺失或版本不符必须停止。所有环境和安装路径均来自本机显式配置，不依赖旧电脑注册表、`D:\tools`、管理员权限或已擦除文件。

| 依赖 | 本包最低检查 | 准备与检查 |
| --- | --- | --- |
| Windows | 能运行下面依赖的 Windows 桌面环境 | 使用 Python/Chrome 厂商仍支持的 Windows 版本及对应 CPU 架构；本包不扩展厂商 OS 支持。 |
| Windows PowerShell | 5.1 或更高，使用 Windows `powershell.exe` | `$PSVersionTable.PSVersion`；预检拒绝不满足要求的执行环境。本包不安装或更改全局执行策略。 |
| Python | 3.12 或更高，真实 `python.exe`；标准库可导入 | 从 [Python 官方 Windows 发布页](https://www.python.org/downloads/windows/)取得适合本机架构的完整安装器。在当前用户权限允许的位置安装；将实际路径传给 `-PythonPath`，或由预检发现并执行。 |
| SQLite | Python 所带 `sqlite3.sqlite_version` 为 3.24 或更高 | 不另装 SQLite。预检实际运行解释器、导入 SQLite、检查版本与可用性。Relay 使用 WAL 与 UPSERT；不要用单独的 `sqlite3.exe` 版本替代 Python 库证据。 |
| Google Chrome | 102 或更高，实际 Chrome 文件；可加载 MV3 unpacked 扩展 | 使用 [Google 官方离线 Chrome 获取说明](https://support.google.com/chrome/a/answer/7650032)；选厂商仍支持的稳定版及本机架构。预检读取实际文件版本；`-ChromePath` 可指定非默认位置。 |
| 运行配置 | 仅用户本地、Leader 授权的非生产验收 scope | 新 Relay token；验收 origin/team/project/issue type/department/root-cause field；唯一符合 scope 的已登录 ONES 标签页。不捆绑真实值。 |
| Planner 输入（可选） | 可信 CASE_FEED、绑定其 exact hash 的 reconciliation、完整新鲜的只读字段快照 | 没有输入就停止 Planner。安装和 Relay 启动不要求这些文件；不生成占位业务数据。 |

Python 3.12 是本包的明确兼容性下界，不宣称所有未来版本已通过运行验证。Chrome 102 的下界来自冻结 popup 直接使用的 [`chrome.storage.session`（Chrome 102+、MV3+）](https://developer.chrome.com/docs/extensions/reference/api/storage)；Bridge 的 [`scripting.executeScript` MAIN world](https://developer.chrome.com/docs/extensions/reference/api/scripting)另有 Chrome 95 下界。最低 API 版本不代表该老版本现在仍受支持。

本包还需要当前用户可写的安装目录和可用的 loopback 端口（默认 `127.0.0.1:18731`）。不要为解决冲突而停止不相关进程、增加远程监听或修改防火墙/受管策略。企业策略阻止脚本或开发者扩展时，由环境负责人提供受批准的安装方式；不能把策略阻塞报告成 PASS。

## 离线安装：在可信联网 Windows 机器上准备

1. 分别从上述 Python/Google 官方 HTTPS 页面下载 **完整离线安装器**，选择目标 Windows/CPU 架构，记录确切版本。不要使用第三方镜像、重新打包文件或仅会联网下载运行时的 bootstrap 安装器。Python 发布页可提供 EXE；Chrome 官方说明可提供独立 EXE/MSI。没有可核验的离线安装器时，报告 `BLOCKED_MISSING_PREREQUISITE`。
2. 对每个真实下载文件在联网机器上检查 Authenticode。下面仅为本地示例，替换成实际文件路径：

   ```powershell
   $installerPath = 'C:\approved\offline\vendor-installer.exe'
   $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
   $signature | Select-Object Status, StatusMessage
   $signature.SignerCertificate | Select-Object Subject, Thumbprint
   Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath
   (Get-Item -LiteralPath $installerPath).Length
   ```

   要求 `Status=Valid`，发行者确认为 Python 的 **Python Software Foundation** 或 Chrome 的 **Google LLC**，并在信任的系统上完成证书链检查。不能只看文件名、图标或一个未知发布者签名。Python 若使用发布页提供的其他签名格式，依照[官方验证说明](https://www.python.org/downloads/metadata/pgp/)和该确切发布文件元数据验证；签名不可用/不确定时停止，不能把本地产生的 SHA256 当作来源证明。
3. 在受控的本地依赖清单记录官方源 URL、下载时间、版本/架构、文件名、字节数、SHA256、有效签名发行者/证书指纹和验证时间。不要在公共仓库记录用户路径或机器识别信息。通过独立可信渠道向离线操作人提供该清单，并用可信介质传输已验证安装器和本项目 ZIP。
4. 在目标离线 Windows 机器安装前，重新计算每个安装器的 SHA256 和字节数，逐一与可信清单完全匹配；一字节不符即停止。可重新检查签名，但离线证书链/吊销信息缺失不能被伪报为 `Valid`；保留联网验证证据与完全匹配的文件 hash。不要因为离线而绕过来源验证。
5. 按厂商安装器的当前用户方式安装。若选定的包要求管理员或在线下载而环境不允许，停止并换成厂商支持、已重新核验的合适安装器；本包不自动提权。
6. 执行项目 `Preflight.ps1`。它验证实际已安装 Python/SQLite/Chrome 与本包 hash；签名与来源准备成功不替代依赖执行检查。

本项目 ZIP 的 SHA256 同样必须匹配 Leader 对确切候选的交付报告。`BUNDLE-MANIFEST.json` 验证包内内容完整性，`VERSION.json` 声明 Bridge 0.5.17 / Relay 0.3.8 / Planner 0.2.0。它们不替代可信交付渠道，也不授权生产运行。依赖版本、安装包字节和测试证据以此次记录为准；不要捏造一个通用的第三方 SHA256。

## 明确不自动恢复的项目

不恢复旧 `relay.db`、`relay-token.txt`、浏览器 credentials、原任务/父任务 ID、历史 planner 输入输出或旧 JSON job；不安装 Big-circle 自动传输、计划任务、周期 reconciliation 或未证明需要的中间件。新 token 与空数据库只由本包 `Start.ps1` 调用原 Relay 的正常启动路径生成。`Install.ps1` 和预检不访问 ONES。

本次交付状态始终是 `OPERATOR_RELEASE=HOLD_WRITER_FIX`。#103 的输入修复、最终包重建、未来新计划身份/hash/授权以及生产 runtime 接受是后续独立 gate。
