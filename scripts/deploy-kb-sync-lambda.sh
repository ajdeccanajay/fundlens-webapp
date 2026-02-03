#!/bin/bash
# Deploy Bedrock KB Sync Lambda to AWS
# This script builds, packages, and deploys the Lambda function

set -e

echo "=========================================="
echo "Deploying Bedrock KB Sync Lambda to AWS"
echo "=========================================="

# Configuration
LAMBDA_DIR="infrastructure/lambda/bedrock-kb-sync"
STACK_NAME="fundlens-bedrock-kb-sync"
LAMBDA_FUNCTION_NAME="bedrock-kb-sync"
REGION="${AWS_REGION:-us-east-1}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Step 1: Installing dependencies...${NC}"
cd "$LAMBDA_DIR"
npm install

echo -e "${YELLOW}Step 2: Building TypeScript...${NC}"
npm run build

echo -e "${YELLOW}Step 3: Packaging Lambda...${NC}"
# Create deployment package with dependencies
cd dist
cp ../package.json .
cp ../package-lock.json .
npm install --production --omit=dev

# Create zip file
zip -r ../lambda.zip . -x "*.ts" "tsconfig.json"
cd ..

PACKAGE_SIZE=$(du -h lambda.zip | cut -f1)
echo -e "${GREEN}Package created: lambda.zip (${PACKAGE_SIZE})${NC}"

# Go back to project root
cd ../../..

echo -e "${YELLOW}Step 4: Deploying CloudFormation stack...${NC}"
# Check if stack exists
STACK_EXISTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" 2>&1 || true)

if echo "$STACK_EXISTS" | grep -q "does not exist"; then
    echo "Creating new stack..."
    aws cloudformation create-stack \
        --stack-name "$STACK_NAME" \
        --template-body file://infrastructure/cloudformation/bedrock-kb-sync.yaml \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$REGION"
    
    echo "Waiting for stack creation..."
    aws cloudformation wait stack-create-complete \
        --stack-name "$STACK_NAME" \
        --region "$REGION"
else
    echo "Updating existing stack..."
    aws cloudformation update-stack \
        --stack-name "$STACK_NAME" \
        --template-body file://infrastructure/cloudformation/bedrock-kb-sync.yaml \
        --capabilities CAPABILITY_NAMED_IAM \
        --region "$REGION" 2>&1 || true
    
    # Wait only if update was initiated
    if [ $? -eq 0 ]; then
        echo "Waiting for stack update..."
        aws cloudformation wait stack-update-complete \
            --stack-name "$STACK_NAME" \
            --region "$REGION" 2>&1 || true
    fi
fi

echo -e "${YELLOW}Step 5: Updating Lambda code...${NC}"
aws lambda update-function-code \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --zip-file "fileb://${LAMBDA_DIR}/lambda.zip" \
    --region "$REGION"

echo -e "${YELLOW}Step 6: Verifying deployment...${NC}"
# Get Lambda function info
LAMBDA_INFO=$(aws lambda get-function \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --region "$REGION" 2>&1)

if echo "$LAMBDA_INFO" | grep -q "FunctionArn"; then
    LAMBDA_ARN=$(echo "$LAMBDA_INFO" | grep -o '"FunctionArn": "[^"]*"' | cut -d'"' -f4)
    LAST_MODIFIED=$(echo "$LAMBDA_INFO" | grep -o '"LastModified": "[^"]*"' | cut -d'"' -f4)
    
    echo -e "${GREEN}=========================================="
    echo "Lambda Deployment Successful!"
    echo "=========================================="
    echo "Function Name: $LAMBDA_FUNCTION_NAME"
    echo "ARN: $LAMBDA_ARN"
    echo "Last Modified: $LAST_MODIFIED"
    echo "Region: $REGION"
    echo -e "==========================================${NC}"
else
    echo -e "${RED}Failed to verify Lambda deployment${NC}"
    echo "$LAMBDA_INFO"
    exit 1
fi

echo -e "${YELLOW}Step 7: Testing Lambda invocation...${NC}"
# Test invoke with a sample event
TEST_EVENT='{"Records":[{"s3":{"bucket":{"name":"fundlens-bedrock-chunks"},"object":{"key":"chunks/TEST/chunk-0.txt"}}}]}'

INVOKE_RESULT=$(aws lambda invoke \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --payload "$TEST_EVENT" \
    --region "$REGION" \
    /tmp/lambda-response.json 2>&1)

if echo "$INVOKE_RESULT" | grep -q "200"; then
    echo -e "${GREEN}Lambda test invocation successful!${NC}"
    echo "Response:"
    cat /tmp/lambda-response.json
    echo ""
else
    echo -e "${YELLOW}Lambda invocation returned non-200 (may be expected for test event)${NC}"
    echo "$INVOKE_RESULT"
fi

echo -e "${GREEN}=========================================="
echo "Deployment Complete!"
echo ""
echo "The Lambda will now automatically trigger when"
echo "files are uploaded to s3://fundlens-bedrock-chunks/chunks/"
echo ""
echo "To test manually:"
echo "  aws lambda invoke --function-name $LAMBDA_FUNCTION_NAME \\"
echo "    --payload '{\"Records\":[{\"s3\":{\"bucket\":{\"name\":\"fundlens-bedrock-chunks\"},\"object\":{\"key\":\"chunks/AAPL/chunk-0.txt\"}}}]}' \\"
echo "    response.json"
echo -e "==========================================${NC}"
