import { createRequire } from 'node:module';
import { homedir, platform } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, copyFileSync } from 'node:fs';

export const CLIENTS = ['claude-desktop', 'cursor', 'cline', 'claude-code'] as const;
export type Client = (typeof CLIENTS)[number];

export interface InstallOptions {
  client: Client;
  aceHome?: string;
  overrideConfigPath?: string;
  overrideMcpBin?: string;
  backup?: boolean;
  /** Force the PATH-command form (for tests). Normally auto-detected. */
  forceGlobal?: boolean;
}

export interface InstallResult {
  configPath: string;
  binPath: string;
  /** 'global' = PATH-resolved `ace-mcp` (survives moving the repo);
   *  'local' = absolute path into this checkout. */
  mode: 'global' | 'local';
  action: 'installed' | 'updated' | 'noop';
  backupPath: string | null;
}

/** True when an `ace-mcp` executable is resolvable on PATH (i.e. globally
 *  installed), without executing it. */
export function aceMcpOnPath(): boolean {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const names = platform() === 'win32' ? ['ace-mcp.cmd', 'ace-mcp.exe', 'ace-mcp.bat', 'ace-mcp'] : ['ace-mcp'];
  return dirs.some((d) => names.some((n) => existsSync(join(d, n))));
}

/** VS Code's per-user config root, shared by the Cline extension's storage. */
function vscodeUserDir(): string {
  const home = homedir();
  switch (platform()) {
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Code', 'User');
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Code', 'User');
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'Code', 'User');
  }
}

/** All four clients read the same `{ mcpServers: { name: {command,args,env} } }`
 *  shape; only the file location differs. */
export function configPathFor(client: Client): string {
  const home = homedir();
  switch (client) {
    case 'claude-desktop':
      switch (platform()) {
        case 'win32':
          return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
        case 'darwin':
          return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        default:
          return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'Claude', 'claude_desktop_config.json');
      }
    case 'cursor':
      return join(home, '.cursor', 'mcp.json');
    case 'claude-code':
      return join(home, '.claude.json');
    case 'cline':
      return join(
        vscodeUserDir(),
        'globalStorage',
        'saoudrizwan.claude-dev',
        'settings',
        'cline_mcp_settings.json',
      );
  }
}

/** @deprecated use configPathFor('claude-desktop') */
export function claudeDesktopConfigPath(): string {
  return configPathFor('claude-desktop');
}

export function resolveAceMcpBin(): string {
  const req = createRequire(import.meta.url);
  const pkgPath = req.resolve('@ace/mcp/package.json');
  const pkg = req('@ace/mcp/package.json') as { bin?: Record<string, string> | string };
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['ace-mcp'];
  if (!rel) throw new Error('@ace/mcp does not declare a bin.ace-mcp');
  return resolve(dirname(pkgPath), rel);
}

export async function installMcp(opts: InstallOptions): Promise<InstallResult> {
  if (!CLIENTS.includes(opts.client)) {
    throw new Error(`unsupported client: ${opts.client}. Supported: ${CLIENTS.join(', ')}`);
  }
  const configPath = opts.overrideConfigPath ?? configPathFor(opts.client);

  // Prefer the PATH-resolved `ace-mcp` when globally installed — that config
  // survives moving or deleting this checkout. Otherwise point at the absolute
  // bin in this checkout (from-source; don't move the folder).
  const useGlobal = opts.forceGlobal ?? (opts.overrideMcpBin ? false : aceMcpOnPath());
  const mode: 'global' | 'local' = useGlobal ? 'global' : 'local';
  const binPath = useGlobal ? 'ace-mcp' : (opts.overrideMcpBin ?? resolveAceMcpBin());
  let command: string;
  let args: string[];
  if (useGlobal) {
    // On Windows the PATH bin is `ace-mcp.cmd`; MCP clients that spawn without
    // a shell can't launch it directly, so wrap it in `cmd /c`.
    if (platform() === 'win32') {
      command = 'cmd';
      args = ['/c', 'ace-mcp'];
    } else {
      command = 'ace-mcp';
      args = [];
    }
  } else {
    command = process.execPath;
    args = [binPath];
  }

  let cfg: Record<string, unknown> = {};
  let hadFile = false;
  if (existsSync(configPath)) {
    hadFile = true;
    const raw = await readFile(configPath, 'utf8');
    if (raw.trim()) cfg = JSON.parse(raw) as Record<string, unknown>;
  }

  const servers = ((cfg.mcpServers as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const desired: Record<string, unknown> = {
    command,
    args,
    env: opts.aceHome ? { ACE_HOME: opts.aceHome } : {},
  };

  const before = servers.ace;
  if (JSON.stringify(before) === JSON.stringify(desired)) {
    return { configPath, binPath, mode, action: 'noop', backupPath: null };
  }

  let backupPath: string | null = null;
  if (hadFile && opts.backup !== false) {
    backupPath = `${configPath}.bak-${Date.now()}`;
    copyFileSync(configPath, backupPath);
  }

  servers.ace = desired;
  cfg.mcpServers = servers;

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return {
    configPath,
    binPath,
    mode,
    action: before === undefined ? 'installed' : 'updated',
    backupPath,
  };
}
