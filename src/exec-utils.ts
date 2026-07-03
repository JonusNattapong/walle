import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Resolve a CLI binary to an absolute path, searching PATH plus common
 * install locations that interactive shells add but child processes may
 * not see (e.g. ~/.local/bin on Windows PowerShell).
 */
export function findExecutable(name: string): string | undefined {
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())
    : [''];

  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  // Fallback locations commonly missing from non-interactive PATH.
  dirs.push(
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  );
  if (isWin && process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm'));

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    if (isWin) {
      // Extension-less shims (e.g. bash scripts installed by native installers)
      const bare = path.join(dir, name);
      if (fs.existsSync(bare) && fs.statSync(bare).isFile()) return bare;
    }
  }
  return undefined;
}

/**
 * Windows cannot spawn .cmd/.bat (or extension-less shim scripts) directly
 * without a shell; real executables should be spawned shell-less so argument
 * quoting stays intact.
 */
export function needsShell(resolvedPath: string): boolean {
  if (process.platform !== 'win32') return false;
  const ext = path.extname(resolvedPath).toLowerCase();
  return ext !== '.exe' && ext !== '.com';
}
