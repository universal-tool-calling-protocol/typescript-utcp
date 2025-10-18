#!/bin/bash

# UTCP Package Publisher
# Publishes packages in the correct dependency order

set -e

echo "🚀 UTCP Package Publisher"
echo "========================="
echo ""

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if logged in to npm
echo -e "${BLUE}Checking npm authentication...${NC}"
if ! npm whoami &> /dev/null; then
    echo -e "${RED}❌ Not logged in to npm. Please run: npm login${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Logged in as: $(npm whoami)${NC}"
echo ""

# Build all packages
echo -e "${BLUE}Building all packages...${NC}"
bun run build
echo -e "${GREEN}✓ Build completed${NC}"
echo ""

# Function to publish a package
publish_package() {
    local package_name=$1
    local package_path=$2
    
    echo -e "${BLUE}Publishing ${package_name}...${NC}"
    cd "$package_path"
    
    # Dry run first
    npm publish --dry-run
    
    # Actual publish
    if npm publish; then
        echo -e "${GREEN}✓ ${package_name} published successfully${NC}"
    else
        echo -e "${RED}❌ Failed to publish ${package_name}${NC}"
        exit 1
    fi
    
    cd - > /dev/null
    echo ""
}

# Publish in dependency order
publish_package "@utcp/sdk" "packages/core"
publish_package "@utcp/text" "packages/text"
publish_package "@utcp/http" "packages/http"
publish_package "@utcp/mcp" "packages/mcp"
publish_package "@utcp/cli" "packages/cli"

echo -e "${GREEN}🎉 All packages published successfully!${NC}"
