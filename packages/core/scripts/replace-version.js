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

// Replace in the compiled version.js file
const versionFilePath = join(__dirname, '..', 'dist', 'version.js');
try {
  let content = readFileSync(versionFilePath, 'utf-8');
  content = content.replace(/__LIB_VERSION__/g, version);
  writeFileSync(versionFilePath, content, 'utf-8');
  console.log(`✓ Updated ${versionFilePath}`);
} catch (error) {
  console.error(`Error updating version file:`, error.message);
  process.exit(1);
}

console.log('Version replacement complete!');
