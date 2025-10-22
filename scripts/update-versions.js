#!/usr/bin/env node

/**
 * Update versions across all packages in the monorepo
 * Usage: node scripts/update-versions.js [major|minor|patch] [version]
 * 
 * Examples:
 *   node scripts/update-versions.js patch          # Bump patch version (1.0.0 -> 1.0.1)
 *   node scripts/update-versions.js minor          # Bump minor version (1.0.0 -> 1.1.0)
 *   node scripts/update-versions.js major          # Bump major version (1.0.0 -> 2.0.0)
 *   node scripts/update-versions.js set 1.2.3      # Set specific version
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACKAGES_DIR = path.resolve(__dirname, '../packages');
const ROOT_DIR = path.resolve(__dirname, '..');

// Package directories
const PACKAGES = ['core', 'http', 'mcp', 'text', 'cli', 'direct-call'];

/**
 * Parse semantic version string
 */
function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || ''
  };
}

/**
 * Bump version based on type
 */
function bumpVersion(currentVersion, bumpType) {
  const version = parseVersion(currentVersion);
  
  switch (bumpType) {
    case 'major':
      version.major += 1;
      version.minor = 0;
      version.patch = 0;
      break;
    case 'minor':
      version.minor += 1;
      version.patch = 0;
      break;
    case 'patch':
      version.patch += 1;
      break;
    default:
      throw new Error(`Unknown bump type: ${bumpType}`);
  }
  
  version.prerelease = '';
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * Update package.json version
 */
function updatePackageVersion(packagePath, newVersion) {
  const packageJsonPath = path.join(packagePath, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    console.warn(`⚠️  Package.json not found: ${packageJsonPath}`);
    return null;
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const oldVersion = packageJson.version;
  
  packageJson.version = newVersion;
  
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  
  return { name: packageJson.name, oldVersion, newVersion };
}

/**
 * Update peer dependencies versions
 */
function updatePeerDependencies(packagePath, updates) {
  const packageJsonPath = path.join(packagePath, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    return;
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  let modified = false;
  
  // Update dependencies
  if (packageJson.dependencies) {
    for (const [name, oldVersion] of Object.entries(packageJson.dependencies)) {
      const update = updates.find(u => u.name === name);
      if (update) {
        packageJson.dependencies[name] = `^${update.newVersion}`;
        console.log(`  Updated dependency ${name}: ${oldVersion} -> ^${update.newVersion}`);
        modified = true;
      }
    }
  }
  
  // Update peerDependencies
  if (packageJson.peerDependencies) {
    for (const [name, oldVersion] of Object.entries(packageJson.peerDependencies)) {
      const update = updates.find(u => u.name === name);
      if (update) {
        packageJson.peerDependencies[name] = `^${update.newVersion}`;
        console.log(`  Updated peerDependency ${name}: ${oldVersion} -> ^${update.newVersion}`);
        modified = true;
      }
    }
  }
  
  if (modified) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  }
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('❌ Usage: node scripts/update-versions.js [major|minor|patch|set] [version?]');
    console.error('\nExamples:');
    console.error('  node scripts/update-versions.js patch');
    console.error('  node scripts/update-versions.js minor');
    console.error('  node scripts/update-versions.js major');
    console.error('  node scripts/update-versions.js set 1.2.3');
    process.exit(1);
  }
  
  const command = args[0];
  let newVersion;
  
  // Get current version from core package
  const corePackagePath = path.join(PACKAGES_DIR, 'core', 'package.json');
  const corePackage = JSON.parse(fs.readFileSync(corePackagePath, 'utf8'));
  const currentVersion = corePackage.version;
  
  console.log(`📦 Current version: ${currentVersion}\n`);
  
  if (command === 'set') {
    if (args.length < 2) {
      console.error('❌ Error: Version number required for "set" command');
      console.error('   Usage: node scripts/update-versions.js set 1.2.3');
      process.exit(1);
    }
    newVersion = args[1];
    
    // Validate version format
    try {
      parseVersion(newVersion);
    } catch (error) {
      console.error(`❌ ${error.message}`);
      process.exit(1);
    }
  } else if (['major', 'minor', 'patch'].includes(command)) {
    newVersion = bumpVersion(currentVersion, command);
  } else {
    console.error(`❌ Unknown command: ${command}`);
    console.error('   Valid commands: major, minor, patch, set');
    process.exit(1);
  }
  
  console.log(`🎯 New version: ${newVersion}\n`);
  
  // Update all package versions
  const updates = [];
  
  console.log('📝 Updating package versions...\n');
  
  for (const pkg of PACKAGES) {
    const packagePath = path.join(PACKAGES_DIR, pkg);
    const result = updatePackageVersion(packagePath, newVersion);
    
    if (result) {
      updates.push(result);
      console.log(`✅ ${result.name}: ${result.oldVersion} -> ${result.newVersion}`);
    }
  }
  
  console.log('\n📝 Updating cross-package dependencies...\n');
  
  // Update peer dependencies in all packages
  for (const pkg of PACKAGES) {
    const packagePath = path.join(PACKAGES_DIR, pkg);
    console.log(`Checking ${pkg}...`);
    updatePeerDependencies(packagePath, updates);
  }
  
  console.log('\n✨ Version update complete!');
  console.log(`\n📋 Summary:`);
  console.log(`   Old version: ${currentVersion}`);
  console.log(`   New version: ${newVersion}`);
  console.log(`   Updated ${updates.length} packages`);
  console.log('\n💡 Next steps:');
  console.log('   1. Review the changes: git diff');
  console.log('   2. Commit the changes: git commit -am "chore: bump version to ${newVersion}"');
  console.log('   3. Build the packages: bun run build');
  console.log('   4. Publish: bun run publish:all');
}

// Run main function
try {
  main();
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
