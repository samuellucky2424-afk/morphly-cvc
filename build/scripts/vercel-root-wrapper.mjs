import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build as esbuild } from 'esbuild';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const apiRoot = resolve(repoRoot, 'api');
const apiOutput = resolve(apiRoot, '.vercel/output');
const staticOutput = resolve(apiOutput, 'static');
const functionsOutput = resolve(apiOutput, 'functions/api');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const endpoints = [
  { source: '_api/health.js', route: '/api/health', output: 'health.func' },
  { source: '_api/account/profile.js', route: '/api/account/profile', output: 'account/profile.func' },
  { source: '_api/payments/create.js', route: '/api/payments/create', output: 'payments/create.func' },
  { source: '_api/payments/verify.js', route: '/api/payments/verify', output: 'payments/verify.func' },
  { source: '_api/usage/start.js', route: '/api/usage/start', output: 'usage/start.func' },
  { source: '_api/usage/stop.js', route: '/api/usage/stop', output: 'usage/stop.func' },
  { source: '_api/usage/tick.js', route: '/api/usage/tick', output: 'usage/tick.func' },
];

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
run(npm, ['run', 'build'], repoRoot);

const distOutput = resolve(repoRoot, 'dist');
if (!existsSync(resolve(distOutput, 'index.html'))) {
  throw new Error(`Expected Vite output at ${distOutput}`);
}

rmSync(apiOutput, { recursive: true, force: true });
mkdirSync(staticOutput, { recursive: true });
mkdirSync(functionsOutput, { recursive: true });
cpSync(distOutput, staticOutput, { recursive: true });

for (const endpoint of endpoints) {
  const functionDir = resolve(functionsOutput, endpoint.output);
  mkdirSync(functionDir, { recursive: true });

  await esbuild({
    entryPoints: [resolve(repoRoot, endpoint.source)],
    outfile: resolve(functionDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
  });

  writeFileSync(
    resolve(functionDir, '.vc-config.json'),
    JSON.stringify(
      {
        runtime: 'nodejs22.x',
        handler: 'index.mjs',
        launcherType: 'Nodejs',
        shouldAddHelpers: true,
      },
      null,
      2
    )
  );

  const displayPath = relative(apiRoot, functionDir).split(sep).join('/');
  console.log(`Built ${endpoint.route} -> ${displayPath}`);
}

writeFileSync(
  resolve(apiOutput, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: '^/(?:(.+)/)?index(?:\\.html)?/?$',
          headers: { Location: '/$1' },
          status: 308,
        },
        {
          src: '^/(.*)\\.html/?$',
          headers: { Location: '/$1' },
          status: 308,
        },
        { handle: 'filesystem' },
        ...endpoints.map((endpoint) => ({
          src: `^${endpoint.route}$`,
          dest: endpoint.route,
          check: true,
        })),
        {
          src: '^/(.*)$',
          dest: '/index.html',
        },
      ],
      overrides: {},
    },
    null,
    2
  )
);

console.log(`Wrote Vercel Build Output API artifact to ${apiOutput}`);
