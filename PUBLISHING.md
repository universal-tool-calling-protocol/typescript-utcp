# Publishing Guide for UTCP Packages

## Prerequisites

1. **NPM Account**: Create an account at [npmjs.com](https://npmjs.com)
2. **Login**: Run `npm login` to authenticate
3. **Org Access**: If using `@utcp` scope, create the org at [npmjs.com/org/create](https://www.npmjs.com/org/create)

## Package Publishing Order

Due to dependencies, publish in this order:

1. **@utcp/sdk** (core) - No dependencies on other @utcp packages
2. **@utcp/text** - Depends on @utcp/sdk
3. **@utcp/http** - Depends on @utcp/sdk
4. **@utcp/mcp** - Depends on @utcp/sdk
5. **@utcp/cli** - Depends on @utcp/sdk

## Publishing Steps

### Option 1: Manual Publishing (Recommended First Time)

```bash
# 1. Build all packages
bun run build

# 2. Publish @utcp/sdk first
cd packages/core
npm publish
cd ../..

# 3. Publish other packages
cd packages/text
npm publish
cd ../..

cd packages/http
npm publish
cd ../..

cd packages/mcp
npm publish
cd ../..

cd packages/cli
npm publish
cd ../..
```

### Option 2: Using the Publish Script

```bash
# Publish all packages at once
bun run publish:all

# Or publish specific packages
bun run publish:core
bun run publish:text
bun run publish:http
bun run publish:mcp
bun run publish:cli
```

## Before Publishing Checklist

- [ ] Update version numbers in package.json files
- [ ] Update CHANGELOG.md (if you have one)
- [ ] Build all packages: `bun run build`
- [ ] Test packages work correctly
- [ ] Update GitHub repository URL in package.json files
- [ ] Update author name in package.json files
- [ ] Commit and push all changes
- [ ] Tag the release: `git tag v1.0.0 && git push --tags`

## Version Updates

Use these commands to bump versions consistently:

```bash
# Patch version (1.0.0 -> 1.0.1)
bun pm -g npm version patch --workspaces

# Minor version (1.0.0 -> 1.1.0)
bun pm -g npm version minor --workspaces

# Major version (1.0.0 -> 2.0.0)
bun pm -g npm version major --workspaces
```

## Troubleshooting

### Permission Denied
- Run `npm login` again
- Check if you have access to the @utcp org

### Package Already Exists
- Increment version number
- Use `npm publish --dry-run` to test

### Type Errors
- Ensure `bun run build` completes successfully
- Check TypeScript configuration

## Important Notes

- **Scoped packages** (`@utcp/*`) require `publishConfig.access: "public"` ✅ Already added
- **Always build** before publishing
- **Test locally** using `npm pack` to see what will be published
- Consider using **npm provenance** for better security: `npm publish --provenance`
