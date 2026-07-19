import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(__dirname, '../bin/ace.js');
let HOME: string;

beforeAll(async () => {
  HOME = await mkdtemp(join(tmpdir(), 'ace-cli-'));
});
afterAll(async () => {
  await rm(HOME, { recursive: true, force: true });
});

function run(args: string[], input?: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ACE_HOME: HOME },
    input,
  });
}

describe('ace CLI', () => {
  it('shows help', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('AI Context Engine');
  });

  it('save via --text then load', () => {
    const s = run(['save', 'cli/one', '--text', 'jwt with 15 minute expiry']);
    expect(s.status).toBe(0);
    expect(s.stdout).toMatch(/saved cli\/one v1/);

    const l = run(['load', 'cli/one', '--shape', 'summary']);
    expect(l.status).toBe(0);
    expect(l.stdout).toContain('jwt with 15 minute expiry');
  });

  it('save via stdin', () => {
    const s = run(['save', 'cli/from-stdin'], 'stdin content here');
    expect(s.status).toBe(0);
    const l = run(['load', 'cli/from-stdin']);
    expect(l.stdout).toContain('stdin content here');
  });

  it('list shows saved contexts', () => {
    const r = run(['list', '--prefix', 'cli/']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('cli/one');
    expect(r.stdout).toContain('cli/from-stdin');
  });

  it('forget removes from list', () => {
    const f = run(['forget', 'cli/one', '--purge']);
    expect(f.status).toBe(0);
    const r = run(['list', '--prefix', 'cli/']);
    expect(r.stdout).not.toContain('cli/one\t');
  });

  it('reports missing context on load', () => {
    const r = run(['load', 'nowhere/nothing']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('context not found');
  });
});
