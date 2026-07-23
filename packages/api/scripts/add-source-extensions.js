/**
 * Add .js extensions to all relative imports in TypeScript source files.
 * Required because Vercel's @vercel/node compiles to ESM and Node.js
 * needs explicit .js extensions for module resolution.
 *
 * Usage: node scripts/add-source-extensions.js
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
      walk(fullPath);
    } else if (entry.name.endsWith('.ts')) {
      fixFile(fullPath);
    }
  }
}

function fixFile(filePath) {
  let content = readFileSync(filePath, 'utf-8');
  const original = content;
  let changed = false;

  // Fix: from './foo' -> from './foo.js' and from '../foo' -> from '../foo.js'
  content = content.replace(
    /(from\s+['"])(\.\.?\/[^'"]+?)(['"](;)?(\s*\/\/.*)?)/g,
    (match, prefix, path, rest) => {
      // Don't add .js if it already has an extension
      if (extname(path)) return match;
      changed = true;
      return `${prefix}${path}.js${rest}`;
    }
  );

  // Fix: import './foo' -> import './foo.js'
  content = content.replace(
    /(import\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
    (match, prefix, path, suffix) => {
      if (extname(path)) return match;
      changed = true;
      return `${prefix}${path}.js${suffix}`;
    }
  );

  if (changed) {
    writeFileSync(filePath, content, 'utf-8');
    console.log(`  fixed: ${filePath.replace(rootDir, '')}`);
  }
}

console.log('Adding .js extensions to TypeScript source imports...');
walk(join(rootDir, 'src'));
walk(join(rootDir, 'api'));
console.log('Done.');
