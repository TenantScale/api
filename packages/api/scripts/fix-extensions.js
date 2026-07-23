/**
 * Post-build script: adds .js extensions to relative imports in dist/
 * Required because tsc with "moduleResolution": "bundler" doesn't add
 * file extensions, but Node.js ESM requires them.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      fixFile(fullPath);
    }
  }
}

function fixFile(filePath) {
  let content = readFileSync(filePath, 'utf-8');
  const original = content;

  // Fix: from './foo' -> from './foo.js'
  // Matches relative imports: from './...' or from '../...'
  content = content.replace(
    /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
    (match, prefix, path, suffix) => {
      // Don't add .js if it already has an extension
      if (extname(path)) return match;
      return `${prefix}${path}.js${suffix}`;
    }
  );

  // Fix: import './foo' -> import './foo.js'
  content = content.replace(
    /(import\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
    (match, prefix, path, suffix) => {
      if (extname(path)) return match;
      return `${prefix}${path}.js${suffix}`;
    }
  );

  if (content !== original) {
    writeFileSync(filePath, content, 'utf-8');
    console.log(`  fixed: ${filePath.replace(distDir, '')}`);
  }
}

console.log('Adding .js extensions to relative imports...');
walk(distDir);
console.log('Done.');
