import { spawn } from 'node:child_process';
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
      const bare = path.join(dir, name);
      if (fs.existsSync(bare) && fs.statSync(bare).isFile()) return bare;
    }
  }
  return undefined;
}

export function needsShell(resolvedPath: string): boolean {
  if (process.platform !== 'win32') return false;
  const ext = path.extname(resolvedPath).toLowerCase();
  return ext !== '.exe' && ext !== '.com';
}

/**
 * Open a new terminal window and run `command` in `cwd`.
 * Returns the child process (pid available). The promise resolves when
 * the terminal window closes (user manually closes it or process exits).
 */
export function spawnInTerminal(command: string, cwd: string, title: string): { child: import('node:child_process').ChildProcess } {
  const plat = process.platform;
  if (plat === 'win32') {
    const tmpFile = path.join(os.tmpdir(), `walle-${title.replace(/[^a-z0-9]/gi, '')}.cmd`);
    fs.writeFileSync(tmpFile, `@echo off\ncd /d "${cwd}"\n${command}\necho.\necho === Task [${title}] finished — close this window ===\npause\n`, 'utf8');
    const child = spawn('cmd.exe', ['/c', 'start', `"walle:${title}"`, '/WAIT', tmpFile], {
      stdio: 'ignore',
      windowsHide: false,
    });
    return { child };
  }
  if (plat === 'darwin') {
    const script = `tell application "Terminal" to activate\n tell application "Terminal" to do script "cd ${escapeShell(cwd)} && ${escapeShell(command)}; echo; echo '=== Task [${title}] finished — close this tab ==='"`;
    const tmpFile = path.join(os.tmpdir(), `walle-${title.replace(/[^a-z0-9]/gi, '')}.sh`);
    fs.writeFileSync(tmpFile, `#!/bin/bash\ncd "${cwd}"\n${command}\necho ""\necho "=== Task [${title}] finished — close this window ==="\n`, 'utf8');
    fs.chmodSync(tmpFile, 0o755);
    const child = spawn('open', ['-a', 'Terminal', tmpFile], { stdio: 'ignore' });
    return { child };
  }
  const terms = [
    { cmd: 'x-terminal-emulator', args: ['-e'] },
    { cmd: 'gnome-terminal', args: ['--', 'bash', '-c'] },
    { cmd: 'xterm', args: ['-e'] },
    { cmd: 'konsole', args: ['-e'] },
  ];
  for (const t of terms) {
    const resolved = findExecutable(t.cmd);
    if (resolved) {
      const fullCommand = `cd ${escapeShell(cwd)} && ${command}; echo; echo '=== Task [${title}] finished ==='; exec bash`;
      const child = spawn(resolved, [...t.args, fullCommand], { stdio: 'ignore' });
      return { child };
    }
  }
  throw new Error('No terminal emulator found (tried gnome-terminal, xterm, konsole)');
}

function escapeShell(s: string): string {
  if (process.platform === 'win32') return `"${s.replace(/"/g, '""')}"`;
  return `'${s.replace(/'/g, "'\\''")}'`;
}
