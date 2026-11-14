/**
 * 本地定制:Claude 订阅会话改由外部启动程序拉起(如 CC Care 独立环境的
 * `~/.cac/envs/<env>/bin/claude`)。
 *
 * 外部启动程序自己负责登录目录、网络出口与启动前检查,Cindy 只把 CLI 换成它,并把它的
 * 配置目录告诉需要读写转录的模块。只作用于订阅会话(nativeCliAuth):网关 / 供应商会话
 * 依赖 ANTHROPIC_BASE_URL 等 env,受管启动程序会把这些 env 清掉,所以继续用内置 CLI 与
 * 默认配置目录。
 *
 * host 在创建 agent 前调用 setClaudeSubscriptionLauncher(固定值或按需解析的函数);
 * 未设置时全部行为与上游一致。会话在**启动那一刻**取一次,之后整段会话固定在该启动程序
 * (跟随模式下切换环境只影响之后新开的会话)。
 */

import os from 'node:os';
import path from 'node:path';

import { findClaudeSessionJsonl } from './claude-projects-fs.js';

export interface ClaudeSubscriptionLauncherPeer {
  /** 日志 / 提示用的来源说明,如 `cc-care:home`。 */
  label: string;
  /** 面向用户的名称,如 `home`。 */
  displayName: string;
  configDir: string;
}

export interface ClaudeSubscriptionLauncher {
  /** 替代内置 Claude Code 的可执行文件(绝对路径)。 */
  executable: string;
  /** 该启动程序实际使用的 CLAUDE_CONFIG_DIR(绝对路径),转录 / 设置都在这里。 */
  configDir: string;
  /** 日志用的来源说明,如 `cc-care:work`。 */
  label?: string;
  /** 面向用户的名称,如 `work`。 */
  displayName?: string;
  /** 额外传给启动程序的 env(如 CAC_CLIENT),不含任何凭证。 */
  env?: Readonly<Record<string, string>>;
  /**
   * 同一宿主下的其它环境(如 CC Care 的其它独立环境)。继续旧任务时据此判断转录属于哪个
   * 环境;读取历史时也会一并查找。
   */
  peers?: readonly ClaudeSubscriptionLauncherPeer[];
}

type LauncherSource = ClaudeSubscriptionLauncher | (() => ClaudeSubscriptionLauncher | null) | null;

let source: LauncherSource = null;
/** Cindy 会话 id → 启动它的订阅启动程序 label。 */
const sessionLabels = new Map<string, string>();

export function setClaudeSubscriptionLauncher(launcher: LauncherSource): void {
  source = launcher;
}

/** 按账号目录取启动程序(如 CC Care 某个环境);host 未设置时只有全局启动程序。 */
type LauncherForConfigDir = (configDir: string) => ClaudeSubscriptionLauncher | null;
let forConfigDir: LauncherForConfigDir | null = null;

export function setClaudeSubscriptionLauncherForConfigDir(resolve: LauncherForConfigDir | null): void {
  forConfigDir = resolve;
}

/**
 * 不传 configDir:全局启动程序(跟随 / 固定的那个环境)。传入任务绑定的订阅账号目录
 * (非默认账号)时:启用启动程序后改由 host 按目录解析 —— 每个 CC Care 环境是一个独立
 * 供应商的账号,任务固定用它所属环境的启动程序;不属于任何环境的目录由 host 返回不可用
 * 的启动程序(启动失败),绝不落到当前环境 = 换了账号。
 */
export function getClaudeSubscriptionLauncher(configDir?: string): ClaudeSubscriptionLauncher | null {
  const current = typeof source === 'function' ? source() : source;
  if (!configDir || !current || !forConfigDir) return current;
  return forConfigDir(configDir);
}

export function noteClaudeSubscriptionSession(sessionId: string, label: string | undefined): void {
  if (label) sessionLabels.set(sessionId, label);
  else sessionLabels.delete(sessionId);
}

/** 该会话启动时使用的订阅启动程序 label;不是经启动程序启动的会话返回 undefined。 */
export function claudeSubscriptionSessionLabel(sessionId: string): string | undefined {
  return sessionLabels.get(sessionId);
}

/**
 * 读写 CLI 转录时可能用到的配置目录(去重,优先级序):显式 CLAUDE_CONFIG_DIR →
 * 订阅启动程序的目录 → 其它环境的目录 → 默认 ~/.claude。首项是新订阅转录的写入根。
 */
export function claudeConfigDirCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const launcher = getClaudeSubscriptionLauncher();
  const out: string[] = [];
  for (const dir of [
    env.CLAUDE_CONFIG_DIR?.trim(),
    launcher?.configDir,
    ...(launcher?.peers ?? []).map((peer) => peer.configDir),
    path.join(os.homedir(), '.claude'),
  ]) {
    if (dir && !out.includes(dir)) out.push(dir);
  }
  return out;
}

/**
 * 继续旧任务前的环境核对:转录在哪个环境,任务就属于哪个环境。
 *
 * 转录不在当前启动程序的目录、却在另一个环境里时抛错 —— 否则 CLI 找不到转录,Cindy 会
 * 把这次继续静默转成全新会话,等于让另一个账号从头接手这个任务。两边都没有时不拦(交给
 * 既有的失效转录处理)。
 */
export async function assertClaudeTranscriptBelongsToLauncher(
  launcher: ClaudeSubscriptionLauncher,
  sdkSessionId: string,
  workingDir: string,
): Promise<void> {
  if (!launcher.peers?.length) return;
  if (await findClaudeSessionJsonl(sdkSessionId, workingDir, path.join(launcher.configDir, 'projects'))) return;
  for (const peer of launcher.peers) {
    if (await findClaudeSessionJsonl(sdkSessionId, workingDir, path.join(peer.configDir, 'projects'))) {
      const current = launcher.displayName ?? launcher.label ?? '当前环境';
      throw new Error(
        `这个任务属于 CC Care 的「${peer.displayName}」环境,当前使用的是「${current}」。`
        + `请在 CC Care 中切回「${peer.displayName}」后再继续这个任务,或新建一个任务。`,
      );
    }
  }
}

/**
 * 交给外部启动程序的 `--settings`:去掉 `apiKeyHelper` 覆盖。
 *
 * 上游恒把 `apiKeyHelper` 置空,防止用户级 helper 抢在订阅 OAuth 之前生效。CC Care 的受管
 * 启动只要在任何设置层(含 `--settings`)看到这个键就拒绝启动(不看值),而它在启动前自己
 * 检查了环境用户设置、项目及上级目录设置与系统托管设置,有 helper 一律拒绝 —— 上游这道防线
 * 在 CC Care 下已由启动程序保证,去掉覆盖不会放宽保护。
 */
export function adaptClaudeFlagSettingsForLauncher<T extends { apiKeyHelper?: unknown }>(settings: T): T {
  const { apiKeyHelper: _removed, ...rest } = settings;
  return rest as T;
}
