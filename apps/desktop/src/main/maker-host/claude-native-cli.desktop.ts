/** Desktop adapters for the shared official CLI lifecycle. */
import { getReadyBinaryPath } from '../agent-binaries/index.js';
import { resolveDesktopOutboundProxy } from './outbound-proxy-resolver.js';
import { readClaudeCliStatusInWorker } from './claudeCliStatusWorkerClient.js';
import { parseClaudeCliLoginStatus } from '@cindy/maker-core';
// 本地定制:在桌面装配注入 CC Care 启动程序。
import { getClaudeSubscriptionLauncherConfig } from './claude-subscription-launcher.js';
import { createClaudeNativeCli } from './claude-native-cli.js';
export { parseClaudeCliLoginStatus };
export { onClaudeCliLoginStatusChange, peekClaudeCliLoginStatus, type ClaudeCliLoginStatus } from './claude-native-cli-status.js';
export type { ClaudeCliPlanUsage, ClaudeCliLoginResult } from './claude-native-cli.js';
export const { claudeCliNetworkEnv, refreshClaudeCliLoginStatus, readClaudeCliLoginStatus, readClaudeCliPlanUsage, parseClaudeCliPlanUsageLine, beginClaudeCliLogin, cancelClaudeCliLogin, runClaudeCliLogin, resetClaudeNativeCliForTest } = createClaudeNativeCli({
  subscriptionLauncher: getClaudeSubscriptionLauncherConfig,
  binaryPath: () => getReadyBinaryPath('claude-code') ?? null,
  resolveOutboundProxy: resolveDesktopOutboundProxy,
  readStatus: async options => parseClaudeCliLoginStatus(await readClaudeCliStatusInWorker(options)),
});
