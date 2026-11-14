// 本地定制(CC Care,docs/local/cc-care-custom-branch.md 不变量 11):Claude 账号只来自 CC Care 环境,
// 每个环境 = 一个 Claude 单独供应商。Cindy 自己登录的额外 Claude 账号不经 CC Care 的出口与身份
// 保护:命令入口拒绝添加 / 登录 / 移出,账号池里只留默认账号与环境账号;Codex 照旧。
// 独立成文件,避免同步上游时与 runtime.test.ts 冲突。tier:unit,账号存储与归属均为内存替身。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionPoolConfig, SubscriptionProvider } from '../../../shared/subscriptionAccounts.js';

const h = vi.hoisted(() => ({
  enabled: true,
  pools: {} as Partial<Record<SubscriptionProvider, SubscriptionPoolConfig>>,
  login: vi.fn(),
  envs: [{ name: 'work', displayName: 'work', configDir: '/cac/envs/work/.claude', executable: '/cac/envs/work/bin/claude' }],
  created: new Map<string, string>(),
}));
vi.mock('../../maker-host/claude-subscription-launcher.js', () => ({
  isClaudeSubscriptionLauncherEnabled: () => h.enabled,
  getClaudeSubscriptionLauncherConfig: () =>
    h.enabled ? { executable: '/cac/envs/work/bin/claude', configDir: '/cac/envs/work/.claude', displayName: 'work' } : null,
  listCcCareEnvironments: () => (h.enabled ? h.envs : []),
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
  accountOwnProvider: (_kind: string, id: string) => h.created.get(id),
  createSubscriptionProvider: async (_kind: string, id: string, name: string) => {
    h.created.set(id, `anthropic-sub-${h.created.size}`);
    return name;
  },
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
import { ccCareAccountId, ccCareEnvironmentForAccount, filterCcCarePool, syncCcCareClaudeProviders } from '../ccCare.js';

beforeEach(() => {
  h.enabled = true;
  h.pools = {};
  h.created.clear();
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
      { action: 'remove', providerId: 'anthropic-sub-12345678', accountId: 'cindy-owner-x' },
      { action: 'remove-provider', providerId: 'anthropic-sub-12345678' },
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
    expect(view.accounts.find((a) => a.id === 'default')?.directory).toBe('/cac/envs/work/.claude');
    const separate = await runSubscriptionAccountCommand({ action: 'read', providerId: 'anthropic-sub-12345678' });
    expect(separate.ccCare).toEqual({ environment: 'work' });
  });

  it('keeps only the default and CC Care environment accounts, each in its own provider', async () => {
    const work = ccCareAccountId('work');
    expect(work).toMatch(/^cindy-owner-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    expect(await syncCcCareClaudeProviders()).toBe(true);
    expect(await syncCcCareClaudeProviders()).toBe(false);
    expect(h.created.size).toBe(1);
    const pool = { ...h.pools.anthropic!, accounts: [...h.pools.anthropic!.accounts, { id: 'cindy-owner-x', paused: false, limit: 4, weight: 1 }] };
    expect(filterCcCarePool('anthropic', pool)?.accounts.map((a) => a.id)).toEqual(['default', work]);
    expect(ccCareEnvironmentForAccount('anthropic', work)?.configDir).toBe('/cac/envs/work/.claude');
    expect(ccCareEnvironmentForAccount('anthropic', 'cindy-owner-x')).toBeUndefined();
    h.enabled = false;
    expect(filterCcCarePool('anthropic', pool)).toBe(pool);
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
