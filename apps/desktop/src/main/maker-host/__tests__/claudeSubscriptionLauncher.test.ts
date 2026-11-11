// 本地定制:CC Care 订阅启动程序配置。守住「无法确认就不回退内置 CLI」、固定 / 跟随两种
// CC Care 模式的解析,合并上游时若有人改动加载逻辑,这里会先失败。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeConfigDirCandidates, getClaudeSubscriptionLauncher } from '@cindy/maker-core';

const harness = vi.hoisted(() => ({ userData: '' }));

vi.mock('../../userDataPath.js', () => ({ getUserDataDir: () => harness.userData }));

vi.mock('../../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  __testing,
  CLAUDE_SUBSCRIPTION_LAUNCHER_FILE,
  getClaudeSubscriptionLauncherConfig,
} from '../claude-subscription-launcher.js';

let root = '';
let cacHome = '';

function writeConfig(content: string): void {
  fs.writeFileSync(path.join(harness.userData, CLAUDE_SUBSCRIPTION_LAUNCHER_FILE), content);
}

function makeEnv(name: string, label?: string): string {
  const envDir = path.join(cacHome, 'envs', name);
  fs.mkdirSync(envDir, { recursive: true });
  const configDir = path.join(root, `${name}-claude`);
  fs.writeFileSync(path.join(envDir, 'managed.json'), JSON.stringify({ configDir }));
  if (label) fs.writeFileSync(path.join(envDir, 'environment.json'), JSON.stringify({ label }));
  return configDir;
}

function markActive(environment: string, pid = process.pid): void {
  fs.writeFileSync(path.join(cacHome, 'active-environment.json'), JSON.stringify({ schema: 1, environment, pid }));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-launcher-'));
  harness.userData = path.join(root, 'userData');
  cacHome = path.join(root, 'cac');
  fs.mkdirSync(harness.userData);
  __testing.reset(cacHome);
});

afterEach(() => {
  __testing.reset();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('claude subscription launcher config', () => {
  it('keeps upstream behavior when there is no config file and CC Care is not installed', () => {
    expect(getClaudeSubscriptionLauncherConfig()).toBeNull();
    expect(getClaudeSubscriptionLauncher()).toBeNull();
  });

  it('follows the active CC Care environment without a config file once CC Care is installed', () => {
    const workDir = makeEnv('work');
    markActive('work');
    expect(getClaudeSubscriptionLauncherConfig()).toMatchObject({
      executable: path.join(cacHome, 'envs', 'work', 'bin', 'claude'),
      configDir: workDir,
      label: 'cc-care:work',
    });
  });

  it('pins a CC Care environment to its launcher, config dir and peers', () => {
    const workDir = makeEnv('work');
    const homeDir = makeEnv('home', '家里');
    writeConfig(JSON.stringify({ ccCareEnv: 'work', cacHome }));

    const launcher = getClaudeSubscriptionLauncherConfig();

    expect(launcher).toMatchObject({
      executable: path.join(cacHome, 'envs', 'work', 'bin', 'claude'),
      configDir: workDir,
      label: 'cc-care:work',
      env: { CAC_CLIENT: 'Cindy' },
      peers: [{ label: 'cc-care:home', displayName: '家里', configDir: homeDir }],
    });
    expect(getClaudeSubscriptionLauncher()).toEqual(launcher);
    expect(claudeConfigDirCandidates({})).toEqual([workDir, homeDir, path.join(os.homedir(), '.claude')]);
  });

  it('follows the environment CC Care marks active', () => {
    makeEnv('work');
    const homeDir = makeEnv('home');
    markActive('home');
    writeConfig(JSON.stringify({ ccCareEnv: '@active', cacHome }));

    expect(getClaudeSubscriptionLauncher()).toBeNull(); // 首次读取前尚未登记
    expect(getClaudeSubscriptionLauncherConfig()).toMatchObject({ label: 'cc-care:home', configDir: homeDir });
    expect(getClaudeSubscriptionLauncher()?.label).toBe('cc-care:home');
  });

  it('fails closed when CC Care has no running environment or its Guard has exited', () => {
    makeEnv('work');
    writeConfig(JSON.stringify({ ccCareEnv: '@active', cacHome }));
    const none = getClaudeSubscriptionLauncherConfig();
    expect(none?.label).toBe('unavailable');
    expect(fs.existsSync(none!.executable)).toBe(false);

    __testing.reset();
    markActive('work', 2 ** 31 - 2);
    expect(getClaudeSubscriptionLauncherConfig()?.label).toBe('unavailable');
  });

  it('fails closed on an invalid config instead of falling back to the bundled CLI', () => {
    writeConfig('{ not json');
    const launcher = getClaudeSubscriptionLauncherConfig();
    expect(launcher?.label).toBe('unavailable');
    expect(fs.existsSync(launcher!.executable)).toBe(false);
  });

  it('can be switched off explicitly even with CC Care installed', () => {
    makeEnv('work');
    markActive('work');
    writeConfig(JSON.stringify({ enabled: false, ccCareEnv: 'work' }));
    expect(getClaudeSubscriptionLauncherConfig()).toBeNull();
  });
});
