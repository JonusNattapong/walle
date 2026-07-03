import { exec } from 'node:child_process';

export interface VerifyResult {
  success: boolean;
  output: string;
}

/** Run the repo's verify command inside the worktree. */
export function verify(command: string, cwd: string): Promise<VerifyResult> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 10 * 60_000 }, (err, stdout, stderr) => {
      resolve({
        success: !err,
        output: (stdout + '\n' + stderr).trim().slice(-4000),
      });
    });
  });
}
