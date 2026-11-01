/**
 * 本地定制:配合 CC Care 的环境切换(见 claude-subscription-launcher.ts)。
 *
 * CC Care 同一时间只允许一个环境在用:只要旧环境里还有 Claude 进程,另一个环境就启动不了。
 * Cindy 打开过的任务即使空闲,CLI 进程也还在,所以这里在 CC Care 当前环境变化后(停掉
 * 旧环境的后台保护 / 切到另一个环境)关闭属于旧环境的**空闲**任务进程;正在执行的任务
 * 不打断,等它这一轮结束再关。关闭后再发消息会照常恢复(届时按当前环境核对归属)。
 *
 * 只有观察到过 CC Care 写的当前环境记录才会关闭任务 —— 旧版 CC Care 不写这个记录,
 * 此时什么都不做,保持固定模式原有行为。
 */

import fs from 'node:fs';
import path from 'node:path';

import { claudeSubscriptionSessionLabel } from '@cindy/maker-core';

import { createLogger } from '../logger.js';
import {
  ccCareHome,
  isFollowingCcCareActiveEnvironment,
  readCcCareActiveEnvironment,
} from './claude-subscription-launcher.js';

const log = createLogger('claude-subscription-env-follow');

const POLL_MS = 3_000;
const CC_CARE_LABEL_PREFIX = 'cc-care:';

export interface FollowableSession {
  readonly id: string;
  readonly agentKind: string;
  isTurnRunning(): boolean;
  hasPendingHostOperation(): boolean;
  hasStartedClosing(): boolean;
}

export interface ClaudeSubscriptionEnvFollowDeps {
  listSessions(): readonly FollowableSession[];
  closeSession(sessionId: string): Promise<void>;
  /** 跟随模式下当前环境变了:刷新登录态 / 模型清单。 */
  onEnvironmentChanged(environment: string | null): void;
  /** 测试注入。 */
  readActive?: (cacHome: string) => string | null;
  recordExists?: (cacHome: string) => boolean;
}

export interface ClaudeSubscriptionEnvFollower {
  /** 立即检查一次(测试与启动时用)。 */
  tick(): Promise<void>;
  stop(): void;
}

function defaultRecordExists(cacHome: string): boolean {
  // 只看文件是否存在,不读内容:存在过即说明 CC Care 支持这个记录。
  try {
    fs.lstatSync(path.join(cacHome, 'active-environment.json'));
    return true;
  } catch {
    return false;
  }
}

export function startClaudeSubscriptionEnvFollow(
  deps: ClaudeSubscriptionEnvFollowDeps,
  options: { autoStart?: boolean } = {},
): ClaudeSubscriptionEnvFollower {
  const cacHome = ccCareHome();
  if (!cacHome) return { tick: async () => {}, stop: () => {} };
  const readActive = deps.readActive ?? readCcCareActiveEnvironment;
  const recordExists = deps.recordExists ?? defaultRecordExists;
  const following = isFollowingCcCareActiveEnvironment();
  let protocolSeen = false;
  let lastActive: string | null | undefined;
  const closing = new Set<string>();
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      if (!protocolSeen && recordExists(cacHome)) protocolSeen = true;
      const active = readActive(cacHome);
      if (active !== lastActive) {
        const first = lastActive === undefined;
        log.info('cc care active environment', { from: lastActive ?? null, to: active });
        lastActive = active;
        if (!first && following) deps.onEnvironmentChanged(active);
      }
      if (!protocolSeen) return;
      for (const session of deps.listSessions()) {
        if (session.agentKind !== 'claude-code' || closing.has(session.id)) continue;
        const label = claudeSubscriptionSessionLabel(session.id);
        if (!label?.startsWith(CC_CARE_LABEL_PREFIX)) continue;
        if (label.slice(CC_CARE_LABEL_PREFIX.length) === active) continue;
        if (session.isTurnRunning() || session.hasPendingHostOperation() || session.hasStartedClosing()) continue;
        closing.add(session.id);
        log.info('closing idle claude task from inactive cc care environment', { sessionId: session.id, label });
        void deps.closeSession(session.id)
          .catch((err) => log.warn('close idle claude task failed', { sessionId: session.id, error: String(err) }))
          .finally(() => closing.delete(session.id));
      }
    } finally {
      running = false;
    }
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  if (options.autoStart !== false) {
    void tick();
    timer = setInterval(() => void tick(), POLL_MS);
    timer.unref?.();
  }
  return {
    tick,
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
