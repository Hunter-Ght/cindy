#!/usr/bin/env node
// 本地定制:`pnpm run package` 只做 Electron 打包,不做整包签名;产物只剩 Electron 自带的
// 链接器签名(标识 `Electron`)。macOS 按签名身份记录屏幕录制 / 辅助功能授权,身份不对时
// 系统设置里开了权限 Cindy 也认不到。这里复用仓库的 ad-hoc 签名步骤补签。
// 用法(仓库根目录):node scripts/local/adhoc-sign-mac.mjs [App 路径]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { adhocSignMacApp, writeMacEntitlements } from '../../apps/desktop/scripts/ci/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = path.resolve(process.argv[2] ?? path.join(root, 'apps/desktop/out/Cindy-darwin-arm64/Cindy.app'));
if (!fs.existsSync(app)) {
  console.error(`找不到 ${app}`);
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-sign-'));
const helper = path.join(dir, 'helper.entitlements');
const main = path.join(dir, 'main.entitlements');
writeMacEntitlements(helper);
writeMacEntitlements(main, { appleEvents: true });
adhocSignMacApp(app, helper, main, 'arm64');
fs.rmSync(dir, { recursive: true, force: true });
console.log(`✔ 已 ad-hoc 签名:${app}`);
