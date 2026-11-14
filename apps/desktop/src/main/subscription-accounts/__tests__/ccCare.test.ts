// 本地定制(CC Care,docs/local/cc-care-custom-branch.md 不变量 11):Cindy 自己登录的额外 Claude
// 账号不经 CC Care 的出口与身份保护。启用启动程序时,账号命令入口必须拒绝添加 / 登录,账号视图
// 只剩 CC Care 当前环境;Codex 账号池照旧。独立成文件,避免同步上游时与 runtime.test.ts 冲突。
// 本次覆盖缺口:上游 create / 独立供应商入口可绕过只按 providerId 判断的门禁。
// 最小输入:Claude create、独立 Claude provider 的 login;经 runSubscriptionAccountCommand
// 验证 SUBSCRIPTION_MANAGED_BY_CC_CARE 且未调用登录。tier:unit,沿用本文件隔离账号存储。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionPoolConfig, SubscriptionProvider } from '../../../shared/subscriptionAccounts.js';

const h = vi.hoisted(() => ({
  enabled: true,
  pools: {} as Partial<Record<SubscriptionProvider, SubscriptionPoolConfig>>,
  login: vi.fn(),
}));
vi.mock('../../maker-host/claude-subscription-launcher.js', () => ({
  isClaudeSubscriptionLauncherEnabled: () => h.enabled,
  getClaudeSubscriptionLauncherConfig: () =>
    h.enabled ? { executable: '/cac/envs/work/bin/claude', configDir: '/cac/envs/work/.claude', displayName: 'work' } : null,
}));
vi.mock('../../appSessionState.js', () => ({
  activeOwnerScopeKey: () => 'owner-a:1',
  isAppSessionBoundaryPending: () => false,
}));
vi.mock('../../maker-host/nativeProviderAuthBinding.js', () => ({
  bindNativeProviderAuth: vi.fn(),
  isNativeProviderAuthBound: () => true,
  isNativeProviderAuthSharedSystemCredential: () => true,
}));
vi.mock('../nativeCli.js', () => ({
  readNativeAccount: async () => ({ authenticated: true, identity: 'a@example.com', authSource: 'oauth' }),
  readNativeAccountUsage: async () => ({}),
  loginNativeAccount: h.login,
  readLegacyCodexAccount: vi.fn(),
  loginLegacyCodexAccount: vi.fn(),
}));
vi.mock('../../maker-host/codex-home-path.js', () => ({ getCodexHome: () => '/codex-home' }));
vi.mock('../../device-link/index.js', () => ({ remoteBackgroundInvoke: vi.fn() }));
vi.mock('../../provider-group/coolingStore.js', () => ({
  readProviderGroupCooling: () => ({}),
  writeProviderGroupCooling: async () => {},
  readSubscriptionAccountCooling: () => ({}),
  writeSubscriptionAccountCooling: async () => {},
  clearSubscriptionAccountCooling: async () => {},
}));
vi.mock('../legacyAccountAccess.js', () => ({
  legacyCodexAccountCanRun: () => true,
  subscriptionRouteAllowsModel: () => true,
}));
vi.mock('../placement.js', () => ({
  resolveSubscriptionPoolProvider: (id: string) => ({
    providerId: id, kind: id === 'anthropic-sub-12345678' ? 'anthropic' : id,
  }),
  providerAccounts: (_kind: string, accounts: unknown[]) => accounts,
  accountProviderId: (kind: string) => kind,
  pinnedOwnAccount: () => undefined,
  readProviderStrategy: () => undefined,
  accountOwnProvider: () => undefined,
  discardUnusedSubscriptionAccountPlacement: async () => {},
  placeSubscriptionAccount: async () => {},
}));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn() }));
vi.mock('../store.js', () => ({
  readLegacyCodexProviderId: () => undefined,
  readLegacyCodexAccountId: () => undefined,
  readPool: (p: SubscriptionProvider) => h.pools[p] ?? null,
  defaultPool: () => ({ strategy: 'least', accounts: [{ id: 'default', paused: false, limit: 4, weight: 1 }] }),
  accountDirectory: (p: string, id: string) => `/home/.${p}-${id}`,
  accountOwnerPrefix: () => 'owner',
  readAccountBinding: () => undefined,
  writeAccountBindings: async () => {},
  updatePool: async (p: SubscriptionProvider, edit: (v: SubscriptionPoolConfig) => SubscriptionPoolConfig) => {
    h.pools[p] = edit(h.pools[p] ?? { strategy: 'least', accounts: [{ id: 'default', paused: false, limit: 4, weight: 1 }] });
  },
}));
import { runSubscriptionAccountCommand } from '../runtime.js';

beforeEach(() => {
  h.enabled = true;
  h.pools = {};
  h.login.mockReset();
});

describe('CC Care manages Claude accounts', () => {
  it('refuses Cindy-side Claude sign-ins and shows only the CC Care environment', async () => {
    for (const command of [
      { action: 'add', providerId: 'anthropic', loginKey: 'k' },
      { action: 'connect', providerId: 'anthropic', target: 'new', loginKey: 'k' },
      { action: 'login', providerId: 'anthropic', accountId: 'cindy-owner-x', loginKey: 'k' },
      // 上游新增独立供应商和 create 入口；不变量 11 必须按类型生效。
      { action: 'create', providerId: 'anthropic', loginKey: 'k' },
      { action: 'login', providerId: 'anthropic-sub-12345678', accountId: 'cindy-owner-x', loginKey: 'k' },
    ] as const) {
      await expect(runSubscriptionAccountCommand(command)).rejects.toThrow('SUBSCRIPTION_MANAGED_BY_CC_CARE');
    }
    expect(h.login).not.toHaveBeenCalled();
    h.pools.anthropic = {
      strategy: 'least',
      accounts: [
        { id: 'default', paused: false, limit: 4, weight: 1 },
        { id: 'cindy-owner-x', paused: false, limit: 4, weight: 1 },
      ],
    };
    const view = await runSubscriptionAccountCommand({ action: 'read', providerId: 'anthropic' });
    expect(view.ccCare).toEqual({ environment: 'work' });
    expect(view.accounts.map((a) => [a.id, a.directory])).toEqual([['default', '/cac/envs/work/.claude']]);
    const separate = await runSubscriptionAccountCommand({ action: 'read', providerId: 'anthropic-sub-12345678' });
    expect(separate.ccCare).toEqual({ environment: 'work' });
  });

  it('leaves Codex accounts and a disabled launcher on upstream behavior', async () => {
    const codex = await runSubscriptionAccountCommand({ action: 'add', providerId: 'openai', loginKey: 'k' });
    expect(codex.ccCare).toBeUndefined();
    expect(h.login).toHaveBeenCalledOnce();
    h.enabled = false;
    await runSubscriptionAccountCommand({ action: 'add', providerId: 'anthropic', loginKey: 'k2' });
    expect(h.login).toHaveBeenCalledTimes(2);
  });
});
