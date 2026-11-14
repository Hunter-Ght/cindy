// 本地定制:CC Care 环境切换时释放旧环境的空闲任务进程,正在执行的任务不打断;
// 旧版 CC Care(不写当前环境记录)时什么都不做。
import os from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { noteClaudeSubscriptionSession } from '@cindy/maker-core';

const harness = vi.hoisted(() => ({ following: true, home: '/cac' as string | null }));

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));
vi.mock('../../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../claude-subscription-launcher.js', () => ({
  ccCareHome: () => harness.home,
  isFollowingCcCareActiveEnvironment: () => harness.following,
  readCcCareActiveEnvironment: () => null,
  readCcCareRunningEnvironments: () => new Set<string>(),
  listCcCareEnvironments: () => [],
}));

import { startClaudeSubscriptionEnvFollow, type FollowableSession } from '../claude-subscription-env-follow.js';

function session(id: string, label: string | undefined, running = false): FollowableSession {
  noteClaudeSubscriptionSession(id, label);
  return {
    id,
    agentKind: 'claude-code',
    isTurnRunning: () => running,
    hasPendingHostOperation: () => false,
    hasStartedClosing: () => false,
  };
}

afterEach(() => {
  harness.following = true;
  harness.home = '/cac';
});

describe('startClaudeSubscriptionEnvFollow', () => {
  it('closes idle tasks of the previous environment and leaves running and current ones alone', async () => {
    let active: string | null = 'work';
    const sessions = [
      session('idle-work', 'cc-care:work'),
      session('busy-work', 'cc-care:work', true),
      session('idle-home', 'cc-care:home'),
      session('gateway', undefined),
    ];
    const closeSession = vi.fn(async (_sessionId: string) => {});
    const onEnvironmentChanged = vi.fn();
    const follower = startClaudeSubscriptionEnvFollow(
      { listSessions: () => sessions, closeSession, onEnvironmentChanged, readActive: () => active, recordExists: () => true },
      { autoStart: false },
    );

    await follower.tick();
    expect(closeSession.mock.calls.map(([id]) => id)).toEqual(['idle-home']);
    expect(onEnvironmentChanged).not.toHaveBeenCalled();

    active = 'home';
    closeSession.mockClear();
    await follower.tick();
    expect(onEnvironmentChanged).toHaveBeenCalledWith('home');
    expect(closeSession.mock.calls.map(([id]) => id)).toEqual(['idle-work']);
  });

  // 本地定制 2026-11:CC Care 0.36.11 起独立环境可以同时运行;仍在运行的环境的空闲任务不能关。
  it('keeps idle tasks of every environment that is still running', async () => {
    const sessions = [session('idle-work', 'cc-care:work'), session('idle-home', 'cc-care:home')];
    const closeSession = vi.fn(async (_sessionId: string) => {});
    let running = new Set(['home']);
    const follower = startClaudeSubscriptionEnvFollow(
      { listSessions: () => sessions, closeSession, onEnvironmentChanged: vi.fn(), readActive: () => 'work',
        readRunning: () => new Set(running), recordExists: () => true },
      { autoStart: false },
    );
    await follower.tick();
    expect(closeSession).not.toHaveBeenCalled();
    running = new Set();
    await follower.tick();
    expect(closeSession.mock.calls.map(([id]) => id)).toEqual(['idle-home']);
  });

  it('does nothing until CC Care has written an active-environment record', async () => {
    const closeSession = vi.fn(async (_sessionId: string) => {});
    const follower = startClaudeSubscriptionEnvFollow(
      {
        listSessions: () => [session('idle-work', 'cc-care:work')],
        closeSession,
        onEnvironmentChanged: vi.fn(),
        readActive: () => null,
        recordExists: () => false,
      },
      { autoStart: false },
    );
    await follower.tick();
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('is inert when no CC Care launcher is configured', async () => {
    harness.home = null;
    const closeSession = vi.fn(async (_sessionId: string) => {});
    const follower = startClaudeSubscriptionEnvFollow(
      { listSessions: () => [session('idle', 'cc-care:work')], closeSession, onEnvironmentChanged: vi.fn(), recordExists: () => true },
      { autoStart: false },
    );
    await follower.tick();
    expect(closeSession).not.toHaveBeenCalled();
  });
});
