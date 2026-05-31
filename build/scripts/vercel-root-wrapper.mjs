import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const apiRoot = resolve(repoRoot, 'api');
const rootOutput = resolve(repoRoot, '.vercel/output');
const apiOutput = resolve(apiRoot, '.vercel/output');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${command} ${args.join(' ')} failed with status ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`Running Morphly Vercel build from repo root: ${repoRoot}`);
run(npm, ['install'], repoRoot);
run(npm, ['run', 'build:vercel'], repoRoot);

if (!existsSync(rootOutput)) {
  throw new Error(`Expected root Vercel output at ${rootOutput}`);
}

rmSync(resolve(apiRoot, '.vercel'), { recursive: true, force: true });
mkdirSync(resolve(apiRoot, '.vercel'), { recursive: true });
cpSync(rootOutput, apiOutput, { recursive: true });
console.log(`Copied Vercel Build Output API artifact to ${apiOutput}`);
