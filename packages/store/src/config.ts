import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface StoreConfig {
  home: string;
  contextsDir: string;
  trashDir: string;
  indexPath: string;
}

export function resolveConfig(overrideHome?: string): StoreConfig {
  const home = resolve(overrideHome ?? process.env.ACE_HOME ?? join(homedir(), '.ace', 'store'));
  return {
    home,
    contextsDir: join(home, 'contexts'),
    trashDir: join(home, 'trash'),
    indexPath: join(home, 'index.db'),
  };
}
