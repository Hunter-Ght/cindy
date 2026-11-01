# 本地定制分支：Cindy × CC Care

> 读取时机：在 `custom/cc-care-launcher` 分支上做任何事之前——同步上游、解决冲突、
> 改定制代码、打包安装、排查「Claude 订阅任务跑不起来」。
>
> 本文件只存在于本地定制分支，上游没有，同步时不会冲突。根 `AGENTS.md` / `CLAUDE.md`
> 里只有一段指向这里的入口。

## 1. 这个分支是什么

- **目的**：被控端（家里这台 Mac）的 Cindy 把 **Claude 订阅任务**交给 CC Care 独立环境里的
  Claude 运行，使用该环境的账号、出口和保护；控制端（公司电脑）用官方 Cindy 远程操作即可。
- **形态**：`origin/main`（官方公开源码）＋ 少量带 `本地定制` 标记的提交。**不推送、不提 PR、
  不合入上游**。上游仓库的 PR 流程、PR 模板、白名单确认门等协作规则对本分支不适用；
  上游的工程与安全规则（凭证不入库、测试真实入口等）照常适用。
- **依赖的另一半**：CC Care 仓库（`~/Documents/cc_care`）提供的约定，见第 4 节。改约定时两边一起改。
- **当前安装**：`/Applications/Cindy.app` 是本分支打的包（版本 `0.0.0`，ad-hoc 签名）。
  官方原版备份在 `~/Cindy-backups/Cindy-0.1.121-official.app`。

## 2. 不变量（改代码、解冲突时都必须守住）

1. **只有订阅会话走 CC Care**（maker-core 里 `nativeCliAuth` 为真的本地会话）。网关 / 供应商 /
   远端 SSH 会话继续用内置 CLI：CC Care 受管启动会清掉所有 `ANTHROPIC_*` 和
   `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`，这些会话走进去会静默落到订阅账号上。
2. **无法确认就拒绝，绝不回退内置 CLI**。配置损坏、CC Care 没有运行中的环境、记录指向的
   Guard 已退出，一律让启动失败并说明原因。回退内置 CLI = 绕开 CC Care 的出口与身份保护直连。
3. **不要把 `CLAUDE_CONFIG_DIR` 写进全局 `process.env`**。SDK 会把 `process.env` 合并进所有
   Claude 子进程，网关会话就会带着 CC Care 账号的资料、不经 Guard 联网。配置目录只能按会话注入。
4. **会话在启动那一刻绑定环境**，之后整段会话固定在该环境；跟随模式下切换环境只影响新任务。
5. **继续旧任务前先核对归属**（`assertClaudeTranscriptBelongsToLauncher`），并且必须放在
   转录预检那个吞异常的 best-effort `try` **之外**、在 `clearInvalidResumeSession` 之前。否则
   CLI 找不到转录时上游会把这次继续静默转成新会话 = 另一个账号从头接手任务。
6. **自动更新必须保持关闭**：`apps/desktop/package.json` 的 `version` 保持 `0.0.0`（上游据此
   把源码包视为「无版本包」并停用应用内更新）。改成真实版本号，官方更新会覆盖本定制版。
   不修改 `updateService.ts` / `cindy-updater`。
7. **定制逻辑放在自己的文件里，上游文件只留最小挂接点**，每处挂接都带 `本地定制` 注释，便于
   冲突时识别。新增挂接点必须同步更新第 3 节清单和 `scripts/local/check-cc-care-customization.mjs`。
8. 旧版 CC Care（不写当前环境记录）下，环境跟随模块什么都不做；不要改成「没记录就关任务」。
9. **交给 CC Care 的 `--settings` 里不能有 CC Care 拒绝的键**。CC Care 见到 `apiKeyHelper`、
   `awsAuthRefresh`、`awsCredentialExport` 键（不论值）、受控 `env`（`ANTHROPIC_*`、
   `CLAUDE_CONFIG_DIR` 等）、非 `claudeai` 的 `forceLoginMethod`、环境外的 `autoMemoryDirectory`
   都会拒绝启动，报错只显示为「Claude Code process exited with code 1」。上游的
   `apiKeyHelper: ''` 防线由 `adaptClaudeFlagSettingsForLauncher` 去掉（CC Care 自己检查所有设置层，
   保护不变）。上游往 `flag-settings.ts` 加新键时，按 CC Care `runtime/auth-policy.cjs` 复核。

## 3. 挂接点清单

| 文件 | 挂接内容 |
| --- | --- |
| `packages/maker-core/src/agents/claude-code/subscription-launcher.ts` | **自有**：启动程序登记、会话→环境 label、配置目录候选、旧任务归属核对 |
| `packages/maker-core/src/agents/claude-code/index.ts` | 订阅会话与模型探测换启动程序、注入 `CLAUDE_CONFIG_DIR` 与启动程序 env、记录会话 label、resume 前归属核对、本地 `--settings` 去掉 `apiKeyHelper` |
| `packages/maker-core/src/agents/claude-code/claude-projects-fs.ts` | `resolveClaudeProjectsRoot` 优先启动程序目录 |
| `packages/maker-core/src/agents/claude-code/fork-jsonl-repair.ts` | 未指定根时在所有配置目录里找转录 |
| `packages/maker-core/src/agents/index.ts` | 导出上述 API |
| `apps/desktop/src/main/maker-host/claude-subscription-launcher.ts` | **自有**：读配置（固定 / `@active` / 自定义）、解析 CC Care 环境、失败即拒绝 |
| `apps/desktop/src/main/maker-host/claude-subscription-env-follow.ts` | **自有**：环境切换后释放旧环境空闲任务、刷新登录态与模型 |
| `apps/desktop/src/main/maker-host/claude-native-cli.ts` | 登录 / 登录态 / 用量用启动程序；启用时不下发代理桥；带上启动程序 env |
| `apps/desktop/src/main/maker-host/index.ts` | `getMaker` 里登记启动程序、启动 / 停止环境跟随 |
| `apps/desktop/src/main/maker-orchestration/claudeTranscriptAnchors.ts` | 转录目录候选加入启动程序目录 |
| `apps/desktop/src/main/maker-host/claude-local-sessions.ts` | 导入本机会话时扫启动程序目录及其 `.claude.json` |
| `apps/desktop/src/main/skillhub/usageIndexer.ts` | 技能用量统计加入启动程序目录 |
| `apps/desktop/src/main/maker-ipc/register.ts` | `runtimeConfigDir` 用启动程序目录 |
| 测试 | `claudeSubscriptionLauncher.test.ts`、`claudeSubscriptionEnvFollow.test.ts`、maker-core `__tests__/subscription-launcher.test.ts`；`claudeNativeCli.test.ts` 与 `claudeTranscriptRelocation.test.ts` 的 mock 补了定制导出 |

已知未覆盖：SkillHub 装到 `~/.claude/skills` 的技能 CC Care 环境看不到；「重置记忆」只清
`~/.claude`；动态 workflow 的逐 agent 进度树（`workflow-progress/reader.ts`）只读 `~/.claude`，
读不到时回退为 workflow 级卡片；CC Care paranoid 模式下启动时读不到订阅余量（任务跑过后由
`rate_limit_event` 补上）。

## 4. 与 CC Care 的约定

配置文件 `~/Library/Application Support/CindyGlobal/claude-subscription-launcher.json`：

- `{ "ccCareEnv": "@active" }`：跟随 CC Care 当前环境（当前使用）。
- `{ "ccCareEnv": "work" }`：固定某个环境。`{ "enabled": false }` 或删除文件：恢复上游行为。
- 修改后重启 Cindy 生效。

CC Care 侧（`~/Documents/cc_care`，正本见其 `AGENTS.md`「Local host integration」一节）：

- 代码在 cc_care 仓库的 `feat/active-environment-for-hosts` 分支（提交 `0ae75ec`，2026-11-01 已安装）；
  合入 cc_care 自己的 main 由用户决定。

- `~/.cac/active-environment.json`（0600，schema 1）由当前环境的 `guard serve` 写入、关闭时删除；
  `cac env active` 可查看。Cindy 只把它当提示，真正的准入仍由环境启动入口负责。
- 环境启动入口 `~/.cac/envs/<env>/bin/claude`，配置目录取 `envs/<env>/managed.json` 的 `configDir`，
  显示名取 `envs/<env>/environment.json` 的 `label`。
- Cindy 启动时带 `CAC_CLIENT=Cindy`，CC Care 在「无法切换」的提示里据此说明是 Cindy 的任务。

## 5. 同步上游流程

前提：工作区干净；先读本文件和上游新版 `AGENTS.md` 的变化。

```bash
cd ~/Documents/cindy
git fetch origin
git tag backup/cc-care-$(date +%Y%m%d-%H%M) custom/cc-care-launcher   # 回滚点
git log --oneline origin/main..custom/cc-care-launcher                   # 确认只有定制提交
git config rerere.enabled true                                            # 重复冲突自动复用解法
git rebase origin/main
```

- **解冲突**：按第 2 节不变量和第 3 节清单**按语义重做挂接**，不要机械地保留旧代码。上游把
  被挂接的函数改名 / 拆分 / 移动时，把挂接点跟过去，并更新清单与检查脚本。
  `AGENTS.md` / `CLAUDE.md` 冲突时保留上游全部内容，再把本地入口段落加回去。
- 解不了或拿不准：`git rebase --abort`，把冲突点和不确定之处告诉用户，不要硬合。
- 新增依赖或换 worktree 时按上游 `docs/dev-rules/environment-setup.md` 重新 `pnpm install`。

同步后必须验证（全部在本仓根目录）：

```bash
node scripts/local/check-cc-care-customization.mjs      # 挂接点、版本号、新增绕行入口
(cd packages/maker-core && pnpm exec tsc --noEmit)
pnpm --filter desktop run typecheck
pnpm test:unit:related
```

- `check-cc-care-customization.mjs` 报「新增调用点」时，逐个判断它是否会让订阅会话绕开启动程序，
  需要就补挂接并把它加进脚本的已知清单。
- 单测失败要和**未改动的 `origin/main`** 对比（`git stash` 或临时 worktree）后才能判定为既有故障。
  截至 2026-11-01 已知既有失败：`askpass.native.test.ts`、`BillingPage.test.tsx`、
  `llamaCppDownloads.test.ts`；`botAutonomySettings.test.tsx` 在整仓并行下偶发失败；整仓运行
  偶发 vitest 进程 SIGSEGV，重跑即可。
- 检查数据库迁移：对比 `apps/desktop/drizzle` 与当前安装版 `/Applications/Cindy.app/Contents/Resources/drizzle`。
  有新增迁移时，安装后数据库会升级，旧版 App 可能无法再打开这份数据——安装前必须先备份数据库，
  并告诉用户。
- 提交：`git commit -s`，提交信息以 `feat(local):` / `fix(local):` 开头并写明是本地定制。

## 6. 打包与安装流程

**打包必须由用户在系统 Terminal.app 里执行**（不要用 CC Care 打开的终端）：Agent 的 shell 运行在
CC Care 沙箱里，SwiftPM 自带的沙箱无法嵌套；不要尝试关闭 SwiftPM 沙箱绕过。

```bash
cd ~/Documents/cindy/apps/desktop
export PATH=~/.local/opt/node/bin:~/.local/bin:$PATH
export CINDY_AUTH_REGION=global SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
pnpm run package
```

`SDKROOT` 原因：本机只有 Command Line Tools，macOS 27 SDK 的 SwiftUI `@State` 宏插件只随完整
Xcode 提供；26.5 SDK 可以编译。装了完整 Xcode 后可去掉。

用户打包完成后，Agent 负责：

1. 核对 `out/Cindy-darwin-arm64/Cindy.app`：`CFBundleIdentifier` 为 `com.xd.cindy`、版本 `0.0.0`、
   `Contents/Resources/cindy-source.json` 的 commit 等于分支 HEAD、`app.asar` 含
   `claude-subscription-launcher.json`。
2. 确认 Cindy 未运行（`pgrep -x Cindy`、数据库无进程占用），再备份数据库与设置文件到
   `~/Cindy-backups/CindyGlobal-data-<时间>/`。
3. 旧 App 移到废纸篓（不要直接删除），`ditto` 安装新包，`open` 启动。
4. 查 `~/Library/Application Support/CindyGlobal/logs/main-<日期>.log`：应有
   `claude subscription launcher active`（`ready: true`）、`cc care active environment`、
   `Versionless build … in-app update disabled`。
5. 提醒用户：签名每次都变，首次启动可能要重新允许钥匙串与系统权限。

回滚：退出 Cindy，把 `~/Cindy-backups/` 里的 App（或废纸篓里的上一版）放回 `/Applications`，
必要时用对应时间的数据库备份。

## 7. 本机环境备忘

- Node 22、pnpm（corepack）、git-lfs 装在 `~/.local`（`~/.local/opt/node/bin`、`~/.local/bin`），
  默认 PATH 里没有，命令前需 `export PATH=...`。
- Agent 的 shell 继承了 CC Care 环境变量（`HTTPS_PROXY` 指向 Guard、`NODE_OPTIONS`、
  `CLAUDE_CONFIG_DIR` 等）。下载依赖、跑测试前先 `unset HTTPS_PROXY https_proxy HTTP_PROXY
  http_proxy ALL_PROXY all_proxy NODE_OPTIONS CLAUDE_CONFIG_DIR CLAUDECODE`，避免开发流量走
  Claude 专用出口、测试被外层会话污染。
- CC Care 修改后要重建 `CC Care.app`、重新准备保护才会生效（见 cc_care 仓库文档）；其环境会话类
  测试在 Agent 沙箱里无法运行，需用户在自己的终端跑 `npm test`。

## 8. 排查「Claude 订阅任务跑不起来」

- 界面 / 远端只显示 `Claude Code process exited with code 1` 时，真正原因在 CC Care 的输出里：
  `grep 'claude-code/stderr' ~/Library/Application\ Support/CindyGlobal/logs/main-$(date +%Y-%m-%d).log`，
  找 `CAC:` 开头的行。常见：
  - 「Claude 设置包含独立的认证方式或账号限制」→ `--settings` 或某个设置文件里有 `apiKeyHelper` 等键（不变量 9）。
  - 「Guard has no fresh validated route」→ CC Care 后台没启动或出口未通过检查，到 CC Care 里处理。
  - 「请先退出环境…再使用另一环境」→ 另一个环境还在用。
  - 路径里带 `claude-subscription-launcher-unavailable` → 配置无效或 CC Care 没有运行中的环境。
- 复现方式：用仓库里的 Agent SDK（`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`）以
  `pathToClaudeCodeExecutable: ~/.cac/envs/<env>/bin/claude` 起一个最小 `query`，带上与 Cindy 相同的
  `settings`，先清掉外层会话的 env（见第 7 节）。只用 `-p` 直接调启动程序**不会**带 `--settings`，
  测不出这类问题（2026-11-01 就因此漏测）。
