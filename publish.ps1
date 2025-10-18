# UTCP Package Publisher (PowerShell)
# Publishes packages in the correct dependency order

$ErrorActionPreference = "Stop"

Write-Host "🚀 UTCP Package Publisher" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan
Write-Host ""

# Check if logged in to npm
Write-Host "Checking npm authentication..." -ForegroundColor Blue
try {
    $npmUser = npm whoami 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Not logged in"
    }
    Write-Host "✓ Logged in as: $npmUser" -ForegroundColor Green
} catch {
    Write-Host "❌ Not logged in to npm. Please run: npm login" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Build all packages
Write-Host "Building all packages..." -ForegroundColor Blue
bun run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Build completed" -ForegroundColor Green
Write-Host ""

# Function to publish a package
function Publish-Package {
    param(
        [string]$PackageName,
        [string]$PackagePath
    )
    
    Write-Host "Publishing $PackageName..." -ForegroundColor Blue
    Push-Location $PackagePath
    
    try {
        # Dry run first
        npm publish --dry-run
        
        # Actual publish
        npm publish
        if ($LASTEXITCODE -ne 0) {
            throw "Publish failed"
        }
        Write-Host "✓ $PackageName published successfully" -ForegroundColor Green
    } catch {
        Write-Host "❌ Failed to publish $PackageName" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    
    Pop-Location
    Write-Host ""
}

# Publish in dependency order
Publish-Package "@utcp/sdk" "packages\core"
Publish-Package "@utcp/text" "packages\text"
Publish-Package "@utcp/http" "packages\http"
Publish-Package "@utcp/mcp" "packages\mcp"
Publish-Package "@utcp/cli" "packages\cli"

Write-Host "🎉 All packages published successfully!" -ForegroundColor Green
