import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);

const WORKTREES_ROOT = path.join(os.homedir(), '.walle', 'worktrees');

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', repo, ...args]);
  return stdout.trim();
}

export async function createWorktree(
  repo: string,
  taskId: string,
  slug: string,
): Promise<{ dir: string; branch: string }> {
  fs.mkdirSync(WORKTREES_ROOT, { recursive: true });
  const branch = `walle/${taskId}-${slug}`;
  const dir = path.join(WORKTREES_ROOT, `${taskId}-${slug}`);
  await git(repo, 'worktree', 'add', '-b', branch, dir);
  return { dir, branch };
}

export async function removeWorktree(repo: string, dir: string, branch: string): Promise<void> {
  await git(repo, 'worktree', 'remove', '--force', dir).catch(() => {});
  await git(repo, 'branch', '-D', branch).catch(() => {});
}

export async function diffWorktree(repo: string, branch: string): Promise<string> {
  const base = await git(repo, 'merge-base', 'HEAD', branch);
  return git(repo, 'diff', `${base}..${branch}`);
}

export async function mergeBranch(repo: string, branch: string): Promise<void> {
  await git(repo, 'merge', '--no-ff', branch, '-m', `walle: merge ${branch}`);
}

/** Commit everything in the worktree so the branch holds the agent's work. */
export async function commitAll(dir: string, message: string): Promise<boolean> {
  await git(dir, 'add', '-A');
  const status = await git(dir, 'status', '--porcelain');
  if (!status) return false;
  await git(dir, 'commit', '-m', message);
  return true;
}
