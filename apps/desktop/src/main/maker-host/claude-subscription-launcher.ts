/**
 * 本地定制:Claude 订阅会话交给 CC Care 独立环境(或其它外部启动程序)运行。
 *
 * 默认(没有配置文件):本机装了 CC Care(存在 `~/.cac/envs`)就按 `{ "ccCareEnv": "@active" }`
 * 跟随 CC Care 当前环境,装上即用;没装 CC Care 则保持上游行为。启动时判断一次。
 *
 * 配置文件 `<userData>/claude-subscription-launcher.json` 可覆盖默认,修改后重启 Cindy 生效:
 *
 *   { "ccCareEnv": "@active" }
 *     → 跟随 CC Care 当前正在使用的环境(`~/.cac/active-environment.json`,由该环境的
 *       Guard 后台写入)。切换环境只影响之后新开的任务;已在运行的任务保持原环境。
 *       CC Care 没有正在运行的环境时,订阅任务拒绝启动。
 *
 *   { "ccCareEnv": "work" }
 *     → 固定使用 `~/.cac/envs/work/bin/claude`,配置目录取该环境 managed.json 的 configDir。
 *
 *   两种 CC Care 模式都可用 "cacHome" 覆盖 `~/.cac`。
 *
 *   { "executable": "/abs/path/claude", "configDir": "/abs/path/.claude" }
 *     → 任意外部启动程序。
 *
 *   { "enabled": false } → 即使装了 CC Care 也恢复内置 Claude Code(上游行为)。
 *
 * 只影响订阅会话(登录、登录状态检查、会话本身);网关 / 供应商会话仍用内置 CLI。
 * 启动程序自己负责网络出口,所以启用后 Cindy 不再给订阅 CLI 下发代理桥。
 *
 * 任何无法确认的情况(配置损坏、CC Care 没有运行中的环境)都**不回退**到内置 CLI(那样会
 * 绕开外部环境的保护直连):改成指向一个不存在的路径,让启动直接失败并在错误里带出原因。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getUserDataDir } from '../userDataPath.js';

import {
  setClaudeSubscriptionLauncher,
  setClaudeSubscriptionLauncherForConfigDir,
  type ClaudeSubscriptionLauncher,
  type ClaudeSubscriptionLauncherPeer,
} from '@cindy/maker-core';

import { createLogger } from '../logger.js';

const log = createLogger('claude-subscription-launcher');

export const CLAUDE_SUBSCRIPTION_LAUNCHER_FILE = 'claude-subscription-launcher.json';
/** 交给 CC Care 的宿主名,仅用于它的会话提示。 */
const CAC_CLIENT = 'Cindy';
const ACTIVE = '@active';
const CACHE_TTL_MS = 10_000;
const ENV_NAME = /^[A-Za-z0-9_-]{1,64}$/;

type Config =
  | { kind: 'off' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'custom'; launcher: ClaudeSubscriptionLauncher }
  | { kind: 'cc-care'; cacHome: string; environment: string };

let config: Config | null = null;
let defaultCacHome = (): string => path.join(os.homedir(), '.cac');
let cache: { key: string; at: number; value: ClaudeSubscriptionLauncher | null } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function expandHome(input: string): string {
  return input === '~' || input.startsWith('~/') ? path.join(os.homedir(), input.slice(1)) : input;
}

function absolute(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 缺失`);
  const resolved = expandHome(value.trim());
  if (!path.isAbsolute(resolved)) throw new Error(`${field} 必须是绝对路径`);
  return resolved;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

function parse(raw: unknown): Config {
  if (!isRecord(raw)) throw new Error('配置必须是 JSON 对象');
  if (raw.enabled === false) return { kind: 'off' };
  if (raw.ccCareEnv !== undefined) {
    const environment = raw.ccCareEnv;
    if (typeof environment !== 'string' || (environment !== ACTIVE && !ENV_NAME.test(environment))) {
      throw new Error('ccCareEnv 无效');
    }
    const cacHome = raw.cacHome === undefined ? defaultCacHome() : absolute(raw.cacHome, 'cacHome');
    return { kind: 'cc-care', cacHome, environment };
  }
  return {
    kind: 'custom',
    launcher: {
      executable: absolute(raw.executable, 'executable'),
      configDir: absolute(raw.configDir, 'configDir'),
      label: typeof raw.label === 'string' ? raw.label : 'custom',
    },
  };
}

/** 没有配置文件:装了 CC Care 就跟随其当前环境,否则保持上游行为。 */
function defaultConfig(): Config {
  const cacHome = defaultCacHome();
  try {
    if (fs.statSync(path.join(cacHome, 'envs')).isDirectory()) return { kind: 'cc-care', cacHome, environment: ACTIVE };
  } catch { /* 没装 CC Care */ }
  return { kind: 'off' };
}

function loadConfig(): Config {
  const file = path.join(getUserDataDir(), CLAUDE_SUBSCRIPTION_LAUNCHER_FILE);
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig();
  }
  try {
    return parse(JSON.parse(raw));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('launcher config invalid; subscription sessions will refuse to start', { file, reason });
    return { kind: 'invalid', reason: `配置文件 ${CLAUDE_SUBSCRIPTION_LAUNCHER_FILE} 无效:${reason}` };
  }
}

/** 指向不存在路径的启动程序:启动时 spawn 失败,错误里带出原因。 */
function unavailable(reason: string, configDir: string, peers: ClaudeSubscriptionLauncherPeer[] = []): ClaudeSubscriptionLauncher {
  return {
    executable: path.join(getUserDataDir(), 'claude-subscription-launcher-unavailable', reason),
    configDir,
    label: 'unavailable',
    displayName: '不可用',
    peers,
  };
}

function ccCareEnvDir(cacHome: string, name: string): string {
  return path.join(cacHome, 'envs', name);
}

function ccCarePeer(cacHome: string, name: string): ClaudeSubscriptionLauncherPeer {
  const envDir = ccCareEnvDir(cacHome, name);
  let configDir = path.join(envDir, '.claude');
  try {
    const managed = readJson(path.join(envDir, 'managed.json'));
    if (isRecord(managed) && typeof managed.configDir === 'string' && path.isAbsolute(managed.configDir)) {
      configDir = managed.configDir;
    }
  } catch { /* 未配置完的环境:用默认目录 */ }
  let displayName = name;
  try {
    const meta = readJson(path.join(envDir, 'environment.json'));
    if (isRecord(meta) && typeof meta.label === 'string' && meta.label.trim()) displayName = meta.label.trim();
  } catch { /* 旧环境没有显示名 */ }
  return { label: `cc-care:${name}`, displayName, configDir };
}

/** 真正可用的环境:有设置文件与启动入口(只剩 subscriptions 之类残留的目录不算)。 */
function isCcCareEnvironment(cacHome: string, name: string): boolean {
  const envDir = ccCareEnvDir(cacHome, name);
  return fs.existsSync(path.join(envDir, 'managed.json')) && fs.existsSync(path.join(envDir, 'bin', 'claude'));
}

function ccCarePeers(cacHome: string): ClaudeSubscriptionLauncherPeer[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(path.join(cacHome, 'envs'))
      .filter((name) => ENV_NAME.test(name) && isCcCareEnvironment(cacHome, name));
  } catch { /* 还没有环境 */ }
  return names.map((name) => ccCarePeer(cacHome, name));
}

function ccCareLauncher(cacHome: string, name: string): ClaudeSubscriptionLauncher {
  const self = ccCarePeer(cacHome, name);
  return {
    executable: path.join(ccCareEnvDir(cacHome, name), 'bin', 'claude'),
    configDir: self.configDir,
    label: self.label,
    displayName: self.displayName,
    env: { CAC_CLIENT },
    peers: ccCarePeers(cacHome).filter((peer) => peer.label !== self.label),
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** CC Care 当前环境:由该环境的 Guard 写入、关闭时删除。读不到或写入进程已退出 → null。 */
export function readCcCareActiveEnvironment(cacHome: string): string | null {
  try {
    const record = readJson(path.join(cacHome, 'active-environment.json'));
    if (!isRecord(record) || record.schema !== 1) return null;
    const { environment, pid } = record;
    if (typeof environment !== 'string' || !ENV_NAME.test(environment)) return null;
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0 || !pidAlive(pid)) return null;
    return environment;
  } catch {
    return null;
  }
}

/**
 * CC Care 正在运行的环境:每个 Guard 自己的记录(`active-environments/<env>.json`,0.36.11 起
 * 可以多个环境同时运行)加上旧的当前环境记录。读不了的记录当作仍在运行,不据此关闭任务。
 */
export function readCcCareRunningEnvironments(cacHome: string): Set<string> {
  const running = new Set<string>();
  const legacy = readCcCareActiveEnvironment(cacHome);
  if (legacy) running.add(legacy);
  let names: string[] = [];
  try {
    names = fs.readdirSync(path.join(cacHome, 'active-environments'));
  } catch { /* 旧版 CC Care 没有这个目录 */ }
  for (const file of names) {
    const name = file.endsWith('.json') ? file.slice(0, -5) : '';
    if (!ENV_NAME.test(name)) continue;
    try {
      const record = readJson(path.join(cacHome, 'active-environments', file));
      if (!isRecord(record) || record.schema !== 1 || record.environment !== name) { running.add(name); continue; }
      const { pid } = record;
      if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0 || pidAlive(pid)) running.add(name);
    } catch {
      running.add(name);
    }
  }
  return running;
}

function cacheKey(current: Config): string {
  if (current.kind !== 'cc-care' || current.environment !== ACTIVE) return current.kind;
  try {
    const st = fs.statSync(path.join(current.cacHome, 'active-environment.json'));
    return `${st.ino}:${st.mtimeMs}:${st.size}`;
  } catch {
    return 'none';
  }
}

function resolve(current: Config): ClaudeSubscriptionLauncher | null {
  switch (current.kind) {
    case 'off':
      return null;
    case 'invalid':
      return unavailable(current.reason, path.join(os.homedir(), '.claude'));
    case 'custom':
      return current.launcher;
    case 'cc-care': {
      if (current.environment !== ACTIVE) return ccCareLauncher(current.cacHome, current.environment);
      const active = readCcCareActiveEnvironment(current.cacHome);
      if (active) return ccCareLauncher(current.cacHome, active);
      return unavailable(
        'CC Care 当前没有正在运行的环境,请先在 CC Care 中启动一个环境的后台保护',
        path.join(current.cacHome, 'no-active-environment'),
        ccCarePeers(current.cacHome),
      );
    }
  }
}

function ensureLoaded(): Config {
  if (!config) {
    config = loadConfig();
    // 按需解析:跟随模式下每次读取都反映 CC Care 当前环境。
    setClaudeSubscriptionLauncher(config.kind === 'off' ? null : () => getClaudeSubscriptionLauncherConfig());
    // 绑定了 CC Care 环境账号的任务按账号目录取该环境的启动程序(见 ccCareLauncherForConfigDir)。
    setClaudeSubscriptionLauncherForConfigDir(config.kind === 'cc-care' ? ccCareLauncherForConfigDir : null);
    if (config.kind !== 'off') log.info('claude subscription launcher configured', { mode: describe(config) });
  }
  return config;
}

function describe(current: Config): string {
  if (current.kind === 'cc-care') return `cc-care:${current.environment}`;
  return current.kind;
}

/** 当前生效的订阅启动程序;未配置返回 null。首次调用时读取配置并登记到 maker-core。 */
export function getClaudeSubscriptionLauncherConfig(): ClaudeSubscriptionLauncher | null {
  const current = ensureLoaded();
  const key = cacheKey(current);
  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < CACHE_TTL_MS) return cache.value;
  const value = resolve(current);
  if (value?.label !== cache?.value?.label) {
    let ready = false;
    if (value) {
      try {
        fs.accessSync(value.executable, fs.constants.X_OK);
        ready = true;
      } catch { /* 下方日志说明;启动时由 spawn 报错 */ }
    }
    log.info('claude subscription launcher active', {
      label: value?.label,
      executable: value?.executable,
      configDir: value?.configDir,
      ready,
    });
  }
  cache = { key, at: now, value };
  return value;
}

/**
 * 是否启用了订阅启动程序(配置无效、CC Care 没有运行中的环境也算启用:这些情形要拒绝启动,
 * 不能当成未启用退回上游行为)。auth-adapters 据此让未指定来源的 Anthropic 模型任务按订阅
 * 会话启动,而不是退回 Cindy 网关 —— 那会用内置 CLI、绕开 CC Care。
 */
export function isClaudeSubscriptionLauncherEnabled(): boolean {
  return ensureLoaded().kind !== 'off';
}

export interface CcCareEnvironment {
  /** 环境名(目录名),如 `work`。 */
  name: string;
  displayName: string;
  configDir: string;
  executable: string;
}

const ENVIRONMENTS_TTL_MS = 2_000;
let environmentsCache: { at: number; value: CcCareEnvironment[] } | null = null;

/**
 * CC Care 模式下的全部可用环境;其它模式返回空。每个环境在 Cindy 里是一个 Claude 单独供应商。
 * 账号池每次读取都会用到,短暂缓存,避免反复扫描环境目录。
 */
export function listCcCareEnvironments(): CcCareEnvironment[] {
  const current = ensureLoaded();
  if (current.kind !== 'cc-care') return [];
  if (environmentsCache && Date.now() - environmentsCache.at < ENVIRONMENTS_TTL_MS) return environmentsCache.value;
  const value = ccCarePeers(current.cacHome).map((peer) => {
    const name = peer.label.slice('cc-care:'.length);
    return {
      name,
      displayName: peer.displayName,
      configDir: peer.configDir,
      executable: path.join(ccCareEnvDir(current.cacHome, name), 'bin', 'claude'),
    };
  });
  environmentsCache = { at: Date.now(), value };
  return value;
}

function sameDir(a: string, b: string): boolean {
  if (path.resolve(a) === path.resolve(b)) return true;
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * 订阅账号目录 → 该 CC Care 环境的启动程序。不属于任何环境的目录(例如 Cindy 以前自己
 * 登录的 `~/.claude-cindy-*`)返回不可用:它们不经 CC Care 的出口与身份保护,也不能换成
 * 当前环境(那等于换了账号)。是否已启动由启动程序自己的准入检查决定。
 */
export function ccCareLauncherForConfigDir(configDir: string): ClaudeSubscriptionLauncher {
  const current = ensureLoaded();
  if (current.kind === 'cc-care') {
    const env = listCcCareEnvironments().find((item) => sameDir(item.configDir, configDir));
    if (env) return ccCareLauncher(current.cacHome, env.name);
  }
  return unavailable(
    '这个 Claude 账号不属于 CC Care 的任何环境,Cindy 不会绕开 CC Care 使用它。请在 CC Care 中为它建立环境',
    configDir,
    current.kind === 'cc-care' ? ccCarePeers(current.cacHome) : [],
  );
}

/** 官方 CLI 读登录态 / 额度 / 登录用:不传目录 = 全局启动程序;CC Care 下按账号目录取环境。 */
export function getClaudeSubscriptionLauncherFor(configDir?: string): ClaudeSubscriptionLauncher | null {
  if (configDir && ensureLoaded().kind === 'cc-care') return ccCareLauncherForConfigDir(configDir);
  return getClaudeSubscriptionLauncherConfig();
}

/** 是否处于「跟随 CC Care 当前环境」模式(只有该模式需要监听环境切换)。 */
export function isFollowingCcCareActiveEnvironment(): boolean {
  const current = ensureLoaded();
  return current.kind === 'cc-care' && current.environment === ACTIVE;
}

/** 固定 / 跟随两种 CC Care 模式下的 CC Care 主目录;其它模式返回 null。 */
export function ccCareHome(): string | null {
  const current = ensureLoaded();
  return current.kind === 'cc-care' ? current.cacHome : null;
}

export const __testing = {
  reset(cacHome?: string): void {
    defaultCacHome = () => cacHome ?? path.join(os.homedir(), '.cac');
    config = null;
    cache = null;
    environmentsCache = null;
    setClaudeSubscriptionLauncher(null);
  },
};
