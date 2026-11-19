import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'velocity-verification-'));
/** Keep disposable browser evidence outside the checkout and private to this user. */
export function artifactPath(relative) {
  if (relative.startsWith('/') || relative.split('/').includes('..')) throw new Error('Use a relative artifact path.');
  const path = join(directory, relative);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  return path;
}
