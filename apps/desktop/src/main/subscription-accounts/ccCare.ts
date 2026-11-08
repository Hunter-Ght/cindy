/**
 * 本地定制(CC Care,见 docs/local/cc-care-custom-branch.md 不变量 11):启用 CC Care 启动程序时,
 * Claude 账号只由 CC Care 的环境决定。上游「供应商内的订阅账号」对 Anthropic 一律视为未配置:
 * 不调度 Cindy 自己登录的额外账号(它们不经 CC Care 的出口与身份保护),也不允许再添加。
 * 设置页据 `ccCare` 字段改为显示 CC Care 当前环境。Codex 账号池不受影响。
 */
import {
  getClaudeSubscriptionLauncherConfig,
  isClaudeSubscriptionLauncherEnabled,
} from '../maker-host/claude-subscription-launcher.js';
import type {
  SubscriptionAccountCommand,
  SubscriptionPoolView,
  SubscriptionProvider,
} from '../../shared/subscriptionAccounts.js';

export const CC_CARE_MANAGED_ERROR = 'SUBSCRIPTION_MANAGED_BY_CC_CARE';

export function ccCareManagesAccounts(provider: SubscriptionProvider): boolean {
  return provider === 'anthropic' && isClaudeSubscriptionLauncherEnabled();
}

/** 只放行只读与「使用检测到的当前账号」;添加、登录、移出、调度设置交给 CC Care。 */
export function assertCcCareAllowsCommand(command: SubscriptionAccountCommand): void {
  if (!ccCareManagesAccounts(command.providerId)) return;
  if (['read', 'preview', 'cancel'].includes(command.action)) return;
  if (command.action === 'connect' && command.target === 'default') return;
  throw new Error(CC_CARE_MANAGED_ERROR);
}

/** 只保留默认行(它的登录态与额度经启动程序读取,即 CC Care 当前环境)。 */
export function applyCcCarePoolView(view: SubscriptionPoolView): SubscriptionPoolView {
  if (!ccCareManagesAccounts(view.providerId)) return view;
  const launcher = getClaudeSubscriptionLauncherConfig();
  return {
    ...view,
    configured: false,
    accounts: view.accounts
      .filter((account) => account.id === 'default')
      .map((account) => ({ ...account, directory: launcher?.configDir ?? account.directory })),
    ccCare: { environment: launcher?.displayName ?? '' },
  };
}
