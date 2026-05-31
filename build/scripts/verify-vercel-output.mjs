import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDir = resolve('public');
const indexPath = resolve(outputDir, 'index.html');

if (!existsSync(outputDir) || !existsSync(indexPath)) {
  throw new Error(`Vercel output was not created at ${outputDir}`);
}

console.log(`Vercel output ready: ${outputDir}`);
console.log(readdirSync(outputDir).join('\n'));
