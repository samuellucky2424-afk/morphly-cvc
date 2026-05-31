import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDir = resolve('.vercel/output');
const staticDir = resolve(outputDir, 'static');
const functionsDir = resolve(outputDir, 'functions');
const configPath = resolve(outputDir, 'config.json');
const indexPath = resolve(staticDir, 'index.html');

if (!existsSync(outputDir) || !existsSync(staticDir) || !existsSync(indexPath) || !existsSync(configPath)) {
  throw new Error(`Vercel Build Output API files were not created at ${outputDir}`);
}

console.log(`Vercel output ready: ${outputDir}`);
console.log(`Static files: ${readdirSync(staticDir).join(', ')}`);
console.log(`Functions: ${existsSync(functionsDir) ? readdirSync(functionsDir).join(', ') : 'none'}`);
console.log(`Config: ${readFileSync(configPath, 'utf8')}`);
