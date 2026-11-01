/**
 * 本地定制:Claude 订阅会话交给 CC Care 独立环境(或其它外部启动程序)运行。
 *
 * 配置文件 `<userData>/claude-subscription-launcher.json`,修改后重启 Cindy 生效:
 *
 *   { "ccCareEnv": "work" }
 *     → 启动程序 `~/.cac/envs/work/bin/claude`,配置目录取该环境 managed.json 的 configDir。
 *       可选 "cacHome" 覆盖 `~/.cac`。
 *
 *   { "executable": "/abs/path/claude", "configDir": "/abs/path/.claude" }
 *     → 任意外部启动程序。
 *
 *   { "enabled": false, ... } 或删除文件 → 恢复内置 Claude Code(上游行为)。
 *
 * 只影响订阅会话(登录、登录状态检查、会话本身);网关 / 供应商会话仍用内置 CLI。
 * 启动程序自己负责网络出口,所以启用后 Cindy 不再给订阅 CLI 下发代理桥。
 *
 * 配置存在但无法解析时**不回退**到内置 CLI(那样会绕开外部环境的保护直连):
 * 改成指向一个不存在的路径,让启动直接失败并在错误里带出原因。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { app } from 'electron';

import { setClaudeSubscriptionLauncher, type ClaudeSubscriptionLauncher } from '@cindy/maker-core';

import { createLogger } from '../logger.js';

const log = createLogger('claude-subscription-launcher');

export const CLAUDE_SUBSCRIPTION_LAUNCHER_FILE = 'claude-subscription-launcher.json';

let loaded = false;
let current: ClaudeSubscriptionLauncher | null = null;

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

function fromCcCare(config: Record<string, unknown>): ClaudeSubscriptionLauncher {
  const name = config.ccCareEnv;
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('ccCareEnv 无效');
  const cacHome = config.cacHome === undefined
    ? path.join(os.homedir(), '.cac')
    : absolute(config.cacHome, 'cacHome');
  const envDir = path.join(cacHome, 'envs', name);
  let configDir = path.join(envDir, '.claude');
  try {
    const managed = JSON.parse(fs.readFileSync(path.join(envDir, 'managed.json'), 'utf8')) as unknown;
    if (isRecord(managed) && typeof managed.configDir === 'string' && path.isAbsolute(managed.configDir)) {
      configDir = managed.configDir;
    }
  } catch (err) {
    log.warn('cc care managed.json unreadable; using default config dir', {
      env: name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { executable: path.join(envDir, 'bin', 'claude'), configDir, label: `cc-care:${name}` };
}

function parse(config: unknown): ClaudeSubscriptionLauncher | null {
  if (!isRecord(config)) throw new Error('配置必须是 JSON 对象');
  if (config.enabled === false) return null;
  if (config.ccCareEnv !== undefined) return fromCcCare(config);
  return {
    executable: absolute(config.executable, 'executable'),
    configDir: absolute(config.configDir, 'configDir'),
    label: typeof config.label === 'string' ? config.label : 'custom',
  };
}

function load(): ClaudeSubscriptionLauncher | null {
  const file = path.join(app.getPath('userData'), CLAUDE_SUBSCRIPTION_LAUNCHER_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    raw = '';
  }
  try {
    return parse(JSON.parse(raw));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('launcher config invalid; subscription sessions will refuse to start', { file, reason });
    return {
      executable: path.join(path.dirname(file), `invalid-${CLAUDE_SUBSCRIPTION_LAUNCHER_FILE}`, reason),
      configDir: path.join(os.homedir(), '.claude'),
      label: 'invalid',
    };
  }
}

/** 读取(首次)并登记到 maker-core;未配置返回 null。 */
export function getClaudeSubscriptionLauncherConfig(): ClaudeSubscriptionLauncher | null {
  if (!loaded) {
    loaded = true;
    current = load();
    setClaudeSubscriptionLauncher(current);
    if (current) {
      let ready = false;
      try {
        fs.accessSync(current.executable, fs.constants.X_OK);
        ready = true;
      } catch { /* 下方日志说明;启动时由 spawn 报错 */ }
      log.info('claude subscription launcher active', {
        label: current.label,
        executable: current.executable,
        configDir: current.configDir,
        ready,
      });
    }
  }
  return current;
}

export const __testing = {
  reset(): void {
    loaded = false;
    current = null;
    setClaudeSubscriptionLauncher(null);
  },
};
