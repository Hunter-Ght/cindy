/**
 * 本地定制:Claude 订阅会话改由外部启动程序拉起(如 CC Care 独立环境的
 * `~/.cac/envs/<env>/bin/claude`)。
 *
 * 外部启动程序自己负责登录目录、网络出口与启动前检查,Cindy 只把 CLI 换成它,并把它的
 * 配置目录告诉需要读写转录的模块。只作用于订阅会话(nativeCliAuth):网关 / 供应商会话
 * 依赖 ANTHROPIC_BASE_URL 等 env,受管启动程序会把这些 env 清掉,所以继续用内置 CLI 与
 * 默认配置目录。
 *
 * host 在创建 agent 前调用 setClaudeSubscriptionLauncher;未设置时全部行为与上游一致。
 */

import os from 'node:os';
import path from 'node:path';

export interface ClaudeSubscriptionLauncher {
  /** 替代内置 Claude Code 的可执行文件(绝对路径)。 */
  executable: string;
  /** 该启动程序实际使用的 CLAUDE_CONFIG_DIR(绝对路径),转录 / 设置都在这里。 */
  configDir: string;
  /** 日志用的来源说明,如 `cc-care:work`。 */
  label?: string;
}

let current: ClaudeSubscriptionLauncher | null = null;

export function setClaudeSubscriptionLauncher(launcher: ClaudeSubscriptionLauncher | null): void {
  current = launcher;
}

export function getClaudeSubscriptionLauncher(): ClaudeSubscriptionLauncher | null {
  return current;
}

/**
 * 读写 CLI 转录时可能用到的配置目录(去重,优先级序):显式 CLAUDE_CONFIG_DIR →
 * 订阅启动程序的目录 → 默认 ~/.claude。首项是新订阅转录的写入根。
 */
export function claudeConfigDirCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const dir of [env.CLAUDE_CONFIG_DIR?.trim(), current?.configDir, path.join(os.homedir(), '.claude')]) {
    if (dir && !out.includes(dir)) out.push(dir);
  }
  return out;
}
