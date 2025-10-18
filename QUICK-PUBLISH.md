# Quick Publish Reference

## 🚀 Fast Track Publishing

### First Time Setup (One Time Only)

```bash
# 1. Login to npm
npm login

# 2. Update package.json files
# - Replace "Your Name" with your actual name
# - Replace "yourusername" in GitHub URLs with your actual username

# 3. Verify you have access to @utcp org or create it
# Visit: https://www.npmjs.com/org/create
```

### Publishing Commands

**Option 1: Automated (Recommended)**
```powershell
# PowerShell (Windows)
.\publish.ps1
```

```bash
# Bash (Mac/Linux)
./publish.sh
```

**Option 2: Using NPM Scripts**
```bash
# Publish all packages
bun run publish:all

# Or individual packages
bun run publish:core    # @utcp/sdk
bun run publish:text    # @utcp/text
bun run publish:http    # @utcp/http
bun run publish:mcp     # @utcp/mcp
bun run publish:cli     # @utcp/cli
```

**Option 3: Manual**
```bash
# 1. Build
bun run build

# 2. Publish in order
cd packages/core && npm publish && cd ../..
cd packages/text && npm publish && cd ../..
cd packages/http && npm publish && cd ../..
cd packages/mcp && npm publish && cd ../..
cd packages/cli && npm publish && cd ../..
```

## 📦 Current Packages

| Package | Version | Description |
|---------|---------|-------------|
| @utcp/sdk | 1.0.0 | Universal Tool Calling Protocol SDK |
| @utcp/mcp | 1.0.1 | Model Context Protocol integration |
| @utcp/text | 1.0.1 | Text utilities |
| @utcp/http | 1.0.1 | HTTP utilities |
| @utcp/cli | 1.0.1 | CLI utilities |

## ⚠️ Before Publishing

1. ✅ All packages have publishing metadata
2. ✅ All packages have README files
3. ✅ Build scripts are configured
4. ⚠️ Update `author` field in all package.json files
5. ⚠️ Update `repository.url` in all package.json files
6. ⚠️ Ensure you're logged in: `npm whoami`
7. ⚠️ Verify build works: `bun run build`

## 🔄 Version Updates

```bash
# Update all package versions (patch: 1.0.0 -> 1.0.1)
cd packages/core && npm version patch && cd ../..
cd packages/text && npm version patch && cd ../..
cd packages/http && npm version patch && cd ../..
cd packages/mcp && npm version patch && cd ../..
cd packages/cli && npm version patch && cd ../..

# Then publish again
bun run publish:all
```

## 📚 Full Documentation

See `PUBLISHING.md` for complete details and troubleshooting.
