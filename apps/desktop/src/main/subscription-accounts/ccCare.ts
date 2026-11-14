/**
 * 本地定制(CC Care,见 docs/local/cc-care-custom-branch.md 不变量 11):启用 CC Care 启动程序时,
 * Claude 账号只来自 CC Care 的环境 —— 每个环境 = Cindy 里一个 Claude 单独供应商(上游 2026-11-13
 * 「选账号就是选供应商」)。
 *
 * - 账号:每个环境在 Anthropic 账号池里有一个固定 ID 的账号(由环境名推导,符合上游账号 ID 格式),
 *   目录就是环境的配置目录;任务绑定账号 = 绑定环境,由该环境的 `bin/claude` 启动。
 * - 内置 Claude 供应商的默认账号继续「跟随 CC Care 当前环境」。
 * - Cindy 自己登录的额外 Claude 账号(`~/.claude-cindy-*`)不经 CC Care 的出口与身份保护:
 *   从账号池里隐藏,既不分配也不显示(数据保留不删)。
 * - 添加、登录、移出账号交给 CC Care(新建 / 删除环境);合并、移动、拿出、调度设置照上游。
 * Codex 账号池不受影响。
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  getClaudeSubscriptionLauncherConfig,
  isClaudeSubscriptionLauncherEnabled,
  listCcCareEnvironments,
  type CcCareEnvironment,
} from '../maker-host/claude-subscription-launcher.js';
import {
  DEFAULT_SUBSCRIPTION_ACCOUNT,
  type SubscriptionAccountCommand,
  type SubscriptionPoolConfig,
  type SubscriptionPoolView,
} from '../../shared/subscriptionAccounts.js';
import { accountOwnerPrefix, readPool, updatePool } from './store.js';
import { accountOwnProvider, createSubscriptionProvider } from './placement.js';
import { isNativeProviderAuthBound } from '../maker-host/nativeProviderAuthBinding.js';

export const CC_CARE_MANAGED_ERROR = 'SUBSCRIPTION_MANAGED_BY_CC_CARE';

export function ccCareManagesAccounts(provider: string): boolean {
  return provider === 'anthropic' && isClaudeSubscriptionLauncherEnabled();
}

/** 环境 → 固定账号 ID:`cindy-<owner 前缀>-<由环境名推导的 UUID 形式>`(上游格式,旧客户端也认)。 */
export function ccCareAccountId(environment: string): string {
  const hex = createHash('sha256').update(`cc-care-environment:${environment}`).digest('hex');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  return `cindy-${accountOwnerPrefix()}-${uuid}`;
}

export function ccCareEnvironmentForAccount(provider: string, accountId: string): CcCareEnvironment | undefined {
  if (accountId === 'default' || !ccCareManagesAccounts(provider)) return undefined;
  return listCcCareEnvironments().find((env) => ccCareAccountId(env.name) === accountId);
}

/** 环境账号 ID;还没有登录的 Cindy 账号(owner)时为空 —— 只剩默认账号,不放出其他目录。 */
function environmentAccountIds(): string[] {
  try {
    return listCcCareEnvironments().map((env) => ccCareAccountId(env.name));
  } catch {
    return [];
  }
}

/** CC Care 下的 Claude 账号池:只留默认账号与 CC Care 环境账号。 */
export function filterCcCarePool(provider: string, pool: SubscriptionPoolConfig | null): SubscriptionPoolConfig | null {
  if (!pool || !ccCareManagesAccounts(provider)) return pool;
  const allowed = new Set(['default', ...environmentAccountIds()]);
  return { ...pool, accounts: pool.accounts.filter((account) => allowed.has(account.id)) };
}

/**
 * 只读、取消、「使用这台电脑上的账号」、调度设置与合并 / 移动 / 拿出照上游;
 * 添加、登录、移出账号与删除供应商交给 CC Care(新建 / 删除环境)。
 */
export function assertCcCareAllowsCommand(command: SubscriptionAccountCommand, kind: string = command.providerId): void {
  if (!ccCareManagesAccounts(kind)) return;
  if (['read', 'preview', 'cancel', 'configure', 'place', 'merge'].includes(command.action)) return;
  if (command.action === 'connect' && command.target === 'default') return;
  throw new Error(CC_CARE_MANAGED_ERROR);
}

/** 设置页据 `ccCare` 隐藏添加 / 登录 / 移出;默认账号的目录显示 CC Care 当前环境的目录。 */
export function applyCcCarePoolView(view: SubscriptionPoolView): SubscriptionPoolView {
  if (!ccCareManagesAccounts(view.kind ?? view.providerId)) return view;
  const launcher = getClaudeSubscriptionLauncherConfig();
  return {
    ...view,
    accounts: view.accounts.map((account) =>
      account.id === 'default' ? { ...account, directory: launcher?.configDir ?? account.directory } : account),
    ccCare: { environment: launcher?.displayName ?? '' },
  };
}

let syncing: Promise<boolean> | null = null;

/**
 * 每个 CC Care 环境确保有一个账号和一个单独供应商「Claude · <环境>」。只增不删:环境不见了,
 * 账号与供应商留着(绑定它的旧任务启动时由启动程序明确报错),用户移动 / 合并过的账号不改。
 * 内置 Claude 连接还没授权、也还没有账号池时不建:否则账号池一出现,内置供应商会显示已连接,
 * 默认账号的任务却因未授权启动失败。用户连接一次 Claude 后再同步。返回是否写入了新内容。
 */
export function syncCcCareClaudeProviders(): Promise<boolean> {
  if (!ccCareManagesAccounts('anthropic')) return Promise.resolve(false);
  if (!readPool('anthropic') && !isNativeProviderAuthBound('anthropic')) return Promise.resolve(false);
  syncing ??= (async () => {
    let changed = false;
    for (const env of listCcCareEnvironments()) {
      const id = ccCareAccountId(env.name);
      // 先记归属再入池(同上游「添加时选择放在哪里」),账号不会短暂出现在内置供应商里。
      if (!accountOwnProvider('anthropic', id)) {
        await createSubscriptionProvider('anthropic', id, `Claude · ${env.displayName}`,
          () => randomUUID().replaceAll('-', '').slice(0, 8));
        changed = true;
      }
      if (!readPool('anthropic')?.accounts.some((account) => account.id === id)) {
        await updatePool('anthropic', (pool) => pool.accounts.some((account) => account.id === id)
          ? pool
          : { ...pool, accounts: [...pool.accounts, { ...DEFAULT_SUBSCRIPTION_ACCOUNT, id }] });
        changed = true;
      }
    }
    return changed;
  })().finally(() => { syncing = null; });
  return syncing;
}
