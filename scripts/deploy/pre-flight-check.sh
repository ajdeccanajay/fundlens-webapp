#!/bin/bash
# =============================================================================
# FundLens - Pre-Flight Deployment Check
# Verifies all prerequisites before deployment
# =============================================================================

set -euo pipefail

echo "=============================================="
echo "FundLens Pre-Flight Deployment Check"
echo "=============================================="
echo ""

CHECKS_PASSED=0
CHECKS_FAILED=0

# Helper functions
check_pass() {
    echo "  ✅ $1"
    ((CHECKS_PASSED++))
}

check_fail() {
    echo "  ❌ $1"
    ((CHECKS_FAILED++))
}

check_warn() {
    echo "  ⚠️  $1"
}

# Check 1: Node.js and npm
echo "📦 Checking Node.js and npm..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    check_pass "Node.js installed: ${NODE_VERSION}"
else
    check_fail "Node.js not found"
fi

if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    check_pass "npm installed: ${NPM_VERSION}"
else
    check_fail "npm not found"
fi
echo ""

# Check 2: Docker
echo "🐳 Checking Docker..."
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    check_pass "Docker installed: ${DOCKER_VERSION}"
    
    # Check if Docker daemon is running
    if docker info &> /dev/null; then
        check_pass "Docker daemon is running"
    else
        check_fail "Docker daemon is not running"
    fi
else
    check_fail "Docker not found"
fi
echo ""

# Check 3: AWS CLI
echo "☁️  Checking AWS CLI..."
if command -v aws &> /dev/null; then
    AWS_VERSION=$(aws --version)
    check_pass "AWS CLI installed: ${AWS_VERSION}"
    
    # Check AWS credentials
    if aws sts get-caller-identity &> /dev/null; then
        AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
        check_pass "AWS credentials configured (Account: ${AWS_ACCOUNT})"
    else
        check_fail "AWS credentials not configured or invalid"
    fi
else
    check_fail "AWS CLI not found"
fi
echo ""

# Check 4: Git
echo "📝 Checking Git..."
if command -v git &> /dev/null; then
    GIT_VERSION=$(git --version)
    check_pass "Git installed: ${GIT_VERSION}"
    
    # Check if we're in a git repository
    if git rev-parse --git-dir &> /dev/null; then
        check_pass "In a Git repository"
        
        # Check for uncommitted changes
        if git diff-index --quiet HEAD --; then
            check_pass "No uncommitted changes"
        else
            check_warn "Uncommitted changes detected"
        fi
        
        # Get current branch
        CURRENT_BRANCH=$(git branch --show-current)
        check_pass "Current branch: ${CURRENT_BRANCH}"
    else
        check_fail "Not in a Git repository"
    fi
else
    check_fail "Git not found"
fi
echo ""

# Check 5: Package.json and build script
echo "📋 Checking package.json..."
if [ -f "package.json" ]; then
    check_pass "package.json exists"
    
    # Check if build script exists
    if grep -q '"build"' package.json; then
        check_pass "Build script found in package.json"
    else
        check_fail "Build script not found in package.json"
    fi
else
    check_fail "package.json not found"
fi
echo ""

# Check 6: Dependencies
echo "📚 Checking dependencies..."
if [ -d "node_modules" ]; then
    check_pass "node_modules directory exists"
else
    check_warn "node_modules not found - run 'npm install'"
fi
echo ""

# Check 7: Dockerfile
echo "🐋 Checking Dockerfile..."
if [ -f "Dockerfile" ]; then
    check_pass "Dockerfile exists"
    
    # Check if Dockerfile has build stage
    if grep -q "npm run build" Dockerfile; then
        check_pass "Dockerfile contains build command"
    else
        check_warn "Dockerfile may not contain build command"
    fi
else
    check_fail "Dockerfile not found"
fi
echo ""

# Check 8: Deployment scripts
echo "🚀 Checking deployment scripts..."
DEPLOY_DIR="scripts/deploy"
if [ -d "${DEPLOY_DIR}" ]; then
    check_pass "Deployment scripts directory exists"
    
    REQUIRED_SCRIPTS=("build-and-push.sh" "deploy-backend.sh" "deploy-frontend.sh" "deploy-all.sh")
    for script in "${REQUIRED_SCRIPTS[@]}"; do
        if [ -f "${DEPLOY_DIR}/${script}" ]; then
            check_pass "${script} exists"
            
            # Check if executable
            if [ -x "${DEPLOY_DIR}/${script}" ]; then
                check_pass "${script} is executable"
            else
                check_warn "${script} is not executable - run 'chmod +x ${DEPLOY_DIR}/${script}'"
            fi
        else
            check_fail "${script} not found"
        fi
    done
else
    check_fail "Deployment scripts directory not found"
fi
echo ""

# Check 9: Environment variables
echo "🔐 Checking environment variables..."
REQUIRED_ENV_VARS=("AWS_REGION")
OPTIONAL_ENV_VARS=("DATABASE_URL" "BEDROCK_KB_ID" "S3_BUCKET_NAME")

for var in "${REQUIRED_ENV_VARS[@]}"; do
    if [ -n "${!var:-}" ]; then
        check_pass "${var} is set"
    else
        check_warn "${var} is not set (may use default)"
    fi
done

for var in "${OPTIONAL_ENV_VARS[@]}"; do
    if [ -n "${!var:-}" ]; then
        check_pass "${var} is set"
    else
        check_warn "${var} is not set (optional)"
    fi
done
echo ""

# Check 10: Build test
echo "🔨 Testing build..."
if npm run build &> /dev/null; then
    check_pass "Build successful"
else
    check_fail "Build failed - run 'npm run build' to see errors"
fi
echo ""

# Summary
echo "=============================================="
echo "Pre-Flight Check Summary"
echo "=============================================="
echo "Checks Passed: ${CHECKS_PASSED}"
echo "Checks Failed: ${CHECKS_FAILED}"
echo ""

if [ ${CHECKS_FAILED} -eq 0 ]; then
    echo "✅ All critical checks passed!"
    echo "You are ready to deploy."
    echo ""
    echo "To deploy, run:"
    echo "  ./scripts/deploy/deploy-all.sh"
    exit 0
else
    echo "❌ Some checks failed!"
    echo "Please fix the issues above before deploying."
    exit 1
fi
