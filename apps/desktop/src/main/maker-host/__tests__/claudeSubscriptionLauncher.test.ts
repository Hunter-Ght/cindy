// 本地定制:CC Care 订阅启动程序配置。守住「配置损坏不回退内置 CLI」与 CC Care 路径解析,
// 合并上游时若有人改动加载逻辑,这里会先失败。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeConfigDirCandidates, getClaudeSubscriptionLauncher } from '@cindy/maker-core';

const harness = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? harness.userData : os.tmpdir()) },
}));

vi.mock('../../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  __testing,
  CLAUDE_SUBSCRIPTION_LAUNCHER_FILE,
  getClaudeSubscriptionLauncherConfig,
} from '../claude-subscription-launcher.js';

let root = '';

function writeConfig(content: string): void {
  fs.writeFileSync(path.join(harness.userData, CLAUDE_SUBSCRIPTION_LAUNCHER_FILE), content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-launcher-'));
  harness.userData = path.join(root, 'userData');
  fs.mkdirSync(harness.userData);
  __testing.reset();
});

afterEach(() => {
  __testing.reset();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('claude subscription launcher config', () => {
  it('keeps upstream behavior when no config file exists', () => {
    expect(getClaudeSubscriptionLauncherConfig()).toBeNull();
    expect(getClaudeSubscriptionLauncher()).toBeNull();
  });

  it('resolves a CC Care environment to its launcher and managed config dir', () => {
    const cacHome = path.join(root, 'cac');
    const envDir = path.join(cacHome, 'envs', 'work');
    fs.mkdirSync(envDir, { recursive: true });
    const configDir = path.join(root, 'managed-claude');
    fs.writeFileSync(path.join(envDir, 'managed.json'), JSON.stringify({ configDir }));
    writeConfig(JSON.stringify({ ccCareEnv: 'work', cacHome }));

    const launcher = getClaudeSubscriptionLauncherConfig();

    expect(launcher).toMatchObject({ executable: path.join(envDir, 'bin', 'claude'), configDir, label: 'cc-care:work' });
    expect(getClaudeSubscriptionLauncher()).toEqual(launcher);
    expect(claudeConfigDirCandidates({})).toEqual([configDir, path.join(os.homedir(), '.claude')]);
  });

  it('fails closed on an invalid config instead of falling back to the bundled CLI', () => {
    writeConfig('{ not json');

    const launcher = getClaudeSubscriptionLauncherConfig();

    expect(launcher).not.toBeNull();
    expect(launcher?.label).toBe('invalid');
    expect(fs.existsSync(launcher!.executable)).toBe(false);
  });

  it('can be switched off explicitly', () => {
    writeConfig(JSON.stringify({ enabled: false, ccCareEnv: 'work' }));
    expect(getClaudeSubscriptionLauncherConfig()).toBeNull();
  });
});
