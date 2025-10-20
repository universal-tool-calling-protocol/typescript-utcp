# Build Scripts

## Version Replacement

The `replace-version.js` script automatically injects the package version into the compiled code during the build process.

### How It Works

1. **Source File**: `src/version.ts` contains a placeholder:
   ```typescript
   export const LIB_VERSION = "__LIB_VERSION__";
   ```

2. **TypeScript Compilation**: The TypeScript compiler builds `src/version.ts` → `dist/version.js`

3. **Post-Build Replacement**: The `replace-version.js` script:
   - Reads the version from `package.json`
   - Replaces `__LIB_VERSION__` with the actual version in `dist/version.js`
   - Example: `"__LIB_VERSION__"` → `"1.0.1"`

4. **Usage in Code**: Other modules import the version:
   ```typescript
   import { LIB_VERSION } from '../version';
   export const UTCP_PACKAGE_VERSION = LIB_VERSION;
   ```

### Build Process

```bash
npm run build
# or
bun run build
```

This runs:
1. `prebuild`: Cleans the `dist` directory
2. `build`: Compiles TypeScript (`tsc`) then runs version replacement
3. Post-build: `replace-version.js` injects the actual version

### Benefits

- ✅ **No runtime environment variables needed**
- ✅ **Version is baked into the compiled code**
- ✅ **Single source of truth**: `package.json`
- ✅ **Works in all environments** (Node.js, browsers, bundlers)
- ✅ **Version consistency** across all modules using `UTCP_PACKAGE_VERSION`

### Adding New Packages

When adding new packages that need version information:

1. Import from `@utcp/sdk`:
   ```typescript
   import { UTCP_PACKAGE_VERSION } from '@utcp/sdk';
   ```

2. Use it in your code:
   ```typescript
   const manual = {
     utcp_version: UTCP_PACKAGE_VERSION,
     manual_version: UTCP_PACKAGE_VERSION,
     tools: []
   };
   ```

**Do not** hardcode version strings like `'1.0'` or `'0.2.0'` anywhere in the codebase.
