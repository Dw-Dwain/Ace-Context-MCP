import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMcp, configPathFor, CLIENTS } from '../src/mcp-install.js';

async function scratch(): Promise<{ dir: string; configPath: string; binPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'ace-mcp-install-'));
  const configDir = join(dir, 'Claude');
  await mkdir(configDir, { recursive: true });
  const configPath = join(configDir, 'claude_desktop_config.json');
  const binPath = join(dir, 'ace-mcp-fake.js');
  await writeFile(binPath, '// fake');
  return { dir, configPath, binPath };
}

describe('installMcp (claude-desktop)', () => {
  it('installs into an empty config location', async () => {
    const { dir, configPath, binPath } = await scratch();
    try {
      const res = await installMcp({
        client: 'claude-desktop',
        overrideConfigPath: configPath,
        overrideMcpBin: binPath,
        aceHome: join(dir, 'store'),
      });
      expect(res.action).toBe('installed');
      expect(res.backupPath).toBeNull();
      const written = JSON.parse(await readFile(configPath, 'utf8')) as {
        mcpServers: { ace: { command: string; args: string[]; env: { ACE_HOME: string } } };
      };
      expect(written.mcpServers.ace.args[0]).toBe(binPath);
      expect(written.mcpServers.ace.env.ACE_HOME).toBe(join(dir, 'store'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves existing servers and backs up', async () => {
    const { dir, configPath, binPath } = await scratch();
    try {
      const preExisting = { mcpServers: { other: { command: 'node', args: ['/other.js'] } } };
      await writeFile(configPath, JSON.stringify(preExisting, null, 2));

      const res = await installMcp({
        client: 'claude-desktop',
        overrideConfigPath: configPath,
        overrideMcpBin: binPath,
      });
      expect(res.action).toBe('installed');
      expect(res.backupPath).toMatch(/\.bak-\d+$/);
      const written = JSON.parse(await readFile(configPath, 'utf8')) as {
        mcpServers: Record<string, unknown>;
      };
      expect(Object.keys(written.mcpServers).sort()).toEqual(['ace', 'other']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent: second install with same inputs is a noop', async () => {
    const { dir, configPath, binPath } = await scratch();
    try {
      const first = await installMcp({
        client: 'claude-desktop',
        overrideConfigPath: configPath,
        overrideMcpBin: binPath,
      });
      expect(first.action).toBe('installed');
      const second = await installMcp({
        client: 'claude-desktop',
        overrideConfigPath: configPath,
        overrideMcpBin: binPath,
      });
      expect(second.action).toBe('noop');
      expect(second.backupPath).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports update when the entry changes', async () => {
    const { dir, configPath, binPath } = await scratch();
    try {
      await installMcp({
        client: 'claude-desktop',
        overrideConfigPath: configPath,
        overrideMcpBin: binPath,
      });
      const updated = await installMcp({
        client: 'claude-desktop',
        overrideConfigPath: configPath,
        overrideMcpBin: binPath,
        aceHome: '/somewhere/else',
      });
      expect(updated.action).toBe('updated');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes a PATH-command (portable) entry in global mode', async () => {
    const { dir, configPath, binPath } = await scratch();
    try {
      const res = await installMcp({
        client: 'claude-code',
        overrideConfigPath: configPath,
        overrideMcpBin: binPath,
        forceGlobal: true,
      });
      expect(res.mode).toBe('global');
      const written = JSON.parse(await readFile(configPath, 'utf8')) as {
        mcpServers: { ace: { command: string; args: string[] } };
      };
      if (process.platform === 'win32') {
        expect(written.mcpServers.ace.command).toBe('cmd');
        expect(written.mcpServers.ace.args).toEqual(['/c', 'ace-mcp']);
      } else {
        expect(written.mcpServers.ace.command).toBe('ace-mcp');
        expect(written.mcpServers.ace.args).toEqual([]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('defaults to local (absolute-path) mode when overrideMcpBin is given', async () => {
    const { dir, configPath, binPath } = await scratch();
    try {
      const res = await installMcp({ client: 'cursor', overrideConfigPath: configPath, overrideMcpBin: binPath });
      expect(res.mode).toBe('local');
      const written = JSON.parse(await readFile(configPath, 'utf8')) as {
        mcpServers: { ace: { args: string[] } };
      };
      expect(written.mcpServers.ace.args[0]).toBe(binPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects unknown clients', async () => {
    await expect(
      installMcp({ client: 'not-a-real-client' as unknown as 'claude-desktop', overrideConfigPath: '/tmp/x' }),
    ).rejects.toThrow(/unsupported client/);
  });

  it('resolves a distinct, plausible config path for every client', () => {
    const paths = CLIENTS.map((c) => configPathFor(c));
    for (const p of paths) expect(p.length).toBeGreaterThan(0);
    expect(new Set(paths).size).toBe(CLIENTS.length);
    expect(configPathFor('claude-desktop')).toMatch(/claude_desktop_config\.json$/);
    expect(configPathFor('cursor')).toMatch(/[/\\]\.cursor[/\\]mcp\.json$/);
    expect(configPathFor('claude-code')).toMatch(/\.claude\.json$/);
    expect(configPathFor('cline')).toMatch(/cline_mcp_settings\.json$/);
  });

  it('installs for cursor, cline, and claude-code (via override path)', async () => {
    for (const client of ['cursor', 'cline', 'claude-code'] as const) {
      const { dir, configPath, binPath } = await scratch();
      try {
        const res = await installMcp({ client, overrideConfigPath: configPath, overrideMcpBin: binPath });
        expect(res.action).toBe('installed');
        const written = JSON.parse(await readFile(configPath, 'utf8')) as {
          mcpServers: { ace: { args: string[] } };
        };
        expect(written.mcpServers.ace.args[0]).toBe(binPath);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
});
