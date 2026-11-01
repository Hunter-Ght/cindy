// 本地定制:继续旧任务前的环境核对。转录在另一个 CC Care 环境里时必须拒绝,否则 CLI 找不到
// 转录会被静默转成全新会话(另一个账号从头接手这个任务)。
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sanitizeClaudeProjectKey } from '../claude-projects-fs.js';
import { assertClaudeTranscriptBelongsToLauncher, type ClaudeSubscriptionLauncher } from '../subscription-launcher.js';

const SID = '11111111-2222-4333-8444-555555555555';
let root = '';
let workDir = '';

async function writeTranscript(configDir: string): Promise<void> {
  const dir = path.join(configDir, 'projects', sanitizeClaudeProjectKey(await fs.realpath(workDir)));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${SID}.jsonl`), '{"type":"user"}\n');
}

function launcher(): ClaudeSubscriptionLauncher {
  return {
    executable: '/unused',
    configDir: path.join(root, 'work'),
    label: 'cc-care:work',
    displayName: 'work',
    peers: [{ label: 'cc-care:home', displayName: '家里', configDir: path.join(root, 'home') }],
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cindy-launcher-owner-'));
  workDir = path.join(root, 'project');
  await fs.mkdir(workDir);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('assertClaudeTranscriptBelongsToLauncher', () => {
  it('allows resuming a task whose transcript is in the current environment', async () => {
    await writeTranscript(path.join(root, 'work'));
    await writeTranscript(path.join(root, 'home'));
    await expect(assertClaudeTranscriptBelongsToLauncher(launcher(), SID, workDir)).resolves.toBeUndefined();
  });

  it('refuses a task that belongs to another environment and names that environment', async () => {
    await writeTranscript(path.join(root, 'home'));
    await expect(assertClaudeTranscriptBelongsToLauncher(launcher(), SID, workDir))
      .rejects.toThrow('这个任务属于 CC Care 的「家里」环境,当前使用的是「work」');
  });

  it('leaves a transcript found nowhere to the existing invalid-resume handling', async () => {
    await expect(assertClaudeTranscriptBelongsToLauncher(launcher(), SID, workDir)).resolves.toBeUndefined();
  });
});
