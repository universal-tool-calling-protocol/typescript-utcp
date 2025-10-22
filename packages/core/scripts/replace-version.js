#!/usr/bin/env node
/**
 * Build script to replace __LIB_VERSION__ placeholder with actual package version.
 * This runs after TypeScript compilation to inject the version into the built files.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json to get the version
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

console.log(`Replacing __LIB_VERSION__ with ${version}`);

// Replace in both ESM and CJS bundles
const filesToUpdate = ['index.js', 'index.cjs'];
let hasError = false;

for (const file of filesToUpdate) {
  const filePath = join(__dirname, '..', 'dist', file);
  try {
    let content = readFileSync(filePath, 'utf-8');
    content = content.replace(/__LIB_VERSION__/g, version);
    writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ Updated ${filePath}`);
  } catch (error) {
    console.error(`Error updating ${file}:`, error.message);
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
}

console.log('Version replacement complete!');
