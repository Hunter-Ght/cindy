#!/usr/bin/env node
// 本地定制分支自检(见 docs/local/cc-care-custom-branch.md)。同步上游后运行:
//   node scripts/local/check-cc-care-customization.mjs
// 1. 每个挂接点仍在;2. 自动更新仍关闭(版本 0.0.0);3. 上游有没有新增可能绕开订阅
//    启动程序的 Claude 启动入口 / 转录路径(有则逐个人工判断,再更新下方 KNOWN 清单)。
// 退出码:0 全部通过;1 有挂接点缺失或版本被改;2 只有需要人工判断的新增调用点。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const count = (text, needle) => text.split(needle).length - 1;

// [文件, 必须出现的片段, 最少次数, 说明]
const HOOKS = [
  ['packages/maker-core/src/agents/claude-code/subscription-launcher.ts', 'export async function assertClaudeTranscriptBelongsToLauncher', 1, '归属核对实现'],
  ['packages/maker-core/src/agents/claude-code/index.ts', 'getClaudeSubscriptionLauncher()', 2, '订阅会话 + 模型探测取启动程序'],
  ['packages/maker-core/src/agents/claude-code/index.ts', 'subscriptionLauncher?.executable ?? this.deps.binaryPath', 2, '换可执行文件'],
  ['packages/maker-core/src/agents/claude-code/index.ts', 'env.CLAUDE_CONFIG_DIR = subscriptionLauncher.configDir', 2, '按会话注入配置目录'],
  ['packages/maker-core/src/agents/claude-code/index.ts', 'noteClaudeSubscriptionSession(opts.sessionId', 1, '记录会话所属环境'],
  ['packages/maker-core/src/agents/claude-code/index.ts', 'await assertClaudeTranscriptBelongsToLauncher(', 1, 'resume 前归属核对'],
  ['packages/maker-core/src/agents/claude-code/index.ts', 'adaptClaudeFlagSettingsForLauncher(buildSettings())', 1, '--settings 去掉 apiKeyHelper(CC Care 见键即拒)'],
  ['packages/maker-core/src/agents/claude-code/claude-projects-fs.ts', 'getClaudeSubscriptionLauncher()?.configDir', 1, 'projects 根优先启动程序目录'],
  ['packages/maker-core/src/agents/claude-code/fork-jsonl-repair.ts', 'claudeConfigDirCandidates()', 1, 'fork 修复跨目录查找'],
  ['packages/maker-core/src/agents/index.ts', "from './claude-code/subscription-launcher.js'", 1, '导出定制 API'],
  ['apps/desktop/src/main/maker-host/claude-native-cli.ts', 'getClaudeSubscriptionLauncherConfig()', 3, 'CLI 路径 / 不下发代理桥 / env'],
  ['apps/desktop/src/main/maker-host/index.ts', 'getClaudeSubscriptionLauncherConfig();', 1, 'getMaker 登记启动程序'],
  ['apps/desktop/src/main/maker-host/auth-adapters.ts', 'claudeSubscriptionLauncherClaimsModel(options?.model)', 2, '未指定来源的 Anthropic 模型不退回网关(getState + getAuthEnv)'],
  ['apps/desktop/src/main/maker-host/__tests__/claudeAuthAdapterOAuthEnv.test.ts', "vi.mock('../claude-subscription-launcher.js'", 1, '测试 mock'],
  ['apps/desktop/src/main/maker-host/index.ts', 'startClaudeSubscriptionEnvFollow(', 1, '启动环境跟随'],
  ['apps/desktop/src/main/maker-host/index.ts', '_claudeSubscriptionEnvFollow?.stop()', 1, '停止环境跟随'],
  ['apps/desktop/src/main/maker-orchestration/claudeTranscriptAnchors.ts', 'getClaudeSubscriptionLauncher()?.configDir', 1, '转录目录候选'],
  ['apps/desktop/src/main/session-import/sources/claude.ts', 'getClaudeSubscriptionLauncher()?.configDir', 1, '本机会话导入'],
  ['apps/desktop/src/main/skillhub/usageIndexer.ts', 'getClaudeSubscriptionLauncher()?.configDir', 1, '技能用量统计'],
  ['apps/desktop/src/main/maker-ipc/register.ts', 'getClaudeSubscriptionLauncher()?.configDir', 1, 'runtimeConfigDir'],
  ['apps/desktop/src/main/maker-host/__tests__/claudeNativeCli.test.ts', "vi.mock('../claude-subscription-launcher.js'", 1, '测试 mock'],
  ['apps/desktop/src/main/maker-host/claude-native-cli.ts', 'launcher ? launcher.env : options.configDir', 1, '不下发额外 Claude 账号目录'],
  ['apps/desktop/src/main/subscription-accounts/store.ts', 'if (ccCareManagesAccounts(provider)) return null;', 1, 'Claude 账号池视为未配置'],
  ['apps/desktop/src/main/subscription-accounts/runtime.ts', 'assertCcCareAllowsCommand(command);', 1, '拒绝添加 / 登录 Claude 账号'],
  ['apps/desktop/src/main/subscription-accounts/runtime.ts', 'return applyCcCarePoolView({', 1, '账号视图显示 CC Care 环境'],
  ['apps/desktop/src/renderer/components/settings/SubscriptionAccountsSection.tsx', 'if (view?.ccCare) return <CcCareClaudeAccounts', 1, '设置页账号区'],
  ['apps/desktop/src/renderer/components/settings/SubscriptionSignInChoices.tsx', '!view?.ccCare &&', 1, '向导隐藏「登录另一个账号」'],
  ['apps/desktop/src/shared/subscriptionAccounts.ts', 'ccCare?: { environment: string }', 1, '账号视图字段'],
];

// 已逐个确认过的调用点:文件 → 次数。上游新增或次数变化时需要人工判断。
const KNOWN = {
  "getReadyBinaryPath('claude-code')": {
    'apps/desktop/src/main/bootstrap-electron.ts': 1, // 注释
    'apps/desktop/src/main/maker-host/index.ts': 1, // getMaker:内置 CLI 给网关会话
    'apps/desktop/src/main/maker-host/claude-native-cli.ts': 1, // 已挂接
  },
  'pathToClaudeCodeExecutable:': {
    'apps/desktop/src/main/maker-host/cc-manager-client.ts': 1, // 远端 SSH,不涉及
    'packages/maker-core/src/agents/claude-code/index.ts': 2, // 已挂接
  },
  "'.claude', 'projects'": {
    'apps/desktop/src/main/workflow-progress/reader.ts': 1, // 已知缺口:逐 agent 进度树,读不到时回退
    'packages/maker-core/src/agents/claude-code/index.ts': 2, // 记忆重置 / 统计,已知缺口
  },
};

const failures = [];
const reviews = [];

for (const [file, needle, min, why] of HOOKS) {
  let text;
  try {
    text = read(file);
  } catch {
    failures.push(`缺少文件 ${file}(${why})`);
    continue;
  }
  const n = count(text, needle);
  if (n < min) failures.push(`${file}: 「${needle}」出现 ${n} 次,至少 ${min} 次(${why})`);
}

const version = JSON.parse(read('apps/desktop/package.json')).version;
if (version !== '0.0.0') failures.push(`apps/desktop/package.json version 为 ${version},必须保持 0.0.0(否则官方更新会覆盖定制版)`);

function sourceFiles() {
  const out = execFileSync('git', ['ls-files', 'apps/desktop/src', 'packages'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter((f) => /\.(m?ts|tsx)$/.test(f) && !/__tests__|\.test\.tsx?$|\/dist\//.test(f));
}

const files = sourceFiles();
for (const [needle, known] of Object.entries(KNOWN)) {
  const seen = {};
  for (const file of files) {
    const n = count(read(file), needle);
    if (n > 0) seen[file] = n;
  }
  for (const [file, n] of Object.entries(seen)) {
    if (known[file] !== n) reviews.push(`「${needle}」${file}: ${n} 次(已知 ${known[file] ?? 0})`);
  }
  for (const file of Object.keys(known)) {
    if (!seen[file]) reviews.push(`「${needle}」已知调用点消失:${file}(上游可能移动了代码,确认挂接是否跟过去)`);
  }
}

if (failures.length) {
  console.error('✖ 定制挂接缺失:');
  for (const line of failures) console.error(`  - ${line}`);
}
if (reviews.length) {
  console.warn('⚠ 需要人工判断(会不会让订阅会话绕开 CC Care / 读错目录?判断后更新本脚本 KNOWN):');
  for (const line of reviews) console.warn(`  - ${line}`);
}
if (!failures.length && !reviews.length) console.log(`✔ CC Care 定制自检通过(${HOOKS.length} 个挂接点,版本 ${version})`);
process.exit(failures.length ? 1 : reviews.length ? 2 : 0);
