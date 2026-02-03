#!/bin/bash

# AWS Credentials Setup Script
# This script helps you configure AWS credentials for Bedrock access

set -e

echo "================================================"
echo "AWS Credentials Setup for FundLens"
echo "================================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo "Please make sure you're in the project root directory."
    exit 1
fi

echo "This script will help you configure AWS credentials."
echo ""
echo "Choose your setup method:"
echo "1) AWS SSO (Recommended if you have it)"
echo "2) IAM User Access Keys"
echo "3) Skip AWS setup (use PostgreSQL fallback)"
echo ""
read -p "Enter your choice (1-3): " choice

case $choice in
    1)
        echo ""
        echo -e "${YELLOW}Setting up AWS SSO...${NC}"
        echo ""
        
        # Check if AWS CLI is installed
        if ! command -v aws &> /dev/null; then
            echo -e "${RED}AWS CLI is not installed!${NC}"
            echo ""
            echo "Please install AWS CLI first:"
            echo "  macOS: brew install awscli"
            echo "  Or visit: https://aws.amazon.com/cli/"
            exit 1
        fi
        
        echo "Please configure AWS SSO:"
        echo ""
        aws configure sso --profile bedrock
        
        echo ""
        echo "Testing AWS SSO connection..."
        if aws sts get-caller-identity --profile bedrock &> /dev/null; then
            echo -e "${GREEN}✓ AWS SSO configured successfully!${NC}"
            
            # Update .env
            if grep -q "AWS_PROFILE=" .env; then
                sed -i.bak 's/^# AWS_PROFILE=.*/AWS_PROFILE=bedrock/' .env
                sed -i.bak 's/^AWS_PROFILE=.*/AWS_PROFILE=bedrock/' .env
            else
                echo "" >> .env
                echo "# AWS SSO Profile" >> .env
                echo "AWS_PROFILE=bedrock" >> .env
            fi
            
            echo ""
            echo -e "${GREEN}✓ .env file updated with AWS_PROFILE=bedrock${NC}"
        else
            echo -e "${RED}✗ AWS SSO configuration failed${NC}"
            echo "Please try again or choose option 2 (Access Keys)"
            exit 1
        fi
        ;;
        
    2)
        echo ""
        echo -e "${YELLOW}Setting up IAM User Access Keys...${NC}"
        echo ""
        echo "You need to create an IAM user in AWS Console first:"
        echo ""
        echo "1. Go to: https://console.aws.amazon.com/iam/"
        echo "2. Click 'Users' → 'Create user'"
        echo "3. User name: fundlens-bedrock-user"
        echo "4. Attach policy: AmazonBedrockFullAccess"
        echo "5. Create access key for 'Application running outside AWS'"
        echo "6. Copy the Access Key ID and Secret Access Key"
        echo ""
        read -p "Press Enter when you have your credentials ready..."
        echo ""
        
        read -p "Enter your AWS Access Key ID (starts with AKIA): " access_key
        read -sp "Enter your AWS Secret Access Key: " secret_key
        echo ""
        
        if [ -z "$access_key" ] || [ -z "$secret_key" ]; then
            echo -e "${RED}Error: Credentials cannot be empty${NC}"
            exit 1
        fi
        
        # Update .env
        if grep -q "AWS_ACCESS_KEY_ID=" .env; then
            sed -i.bak "s|^# AWS_ACCESS_KEY_ID=.*|AWS_ACCESS_KEY_ID=$access_key|" .env
            sed -i.bak "s|^AWS_ACCESS_KEY_ID=.*|AWS_ACCESS_KEY_ID=$access_key|" .env
        else
            echo "" >> .env
            echo "# AWS Access Keys" >> .env
            echo "AWS_ACCESS_KEY_ID=$access_key" >> .env
        fi
        
        if grep -q "AWS_SECRET_ACCESS_KEY=" .env; then
            sed -i.bak "s|^# AWS_SECRET_ACCESS_KEY=.*|AWS_SECRET_ACCESS_KEY=$secret_key|" .env
            sed -i.bak "s|^AWS_SECRET_ACCESS_KEY=.*|AWS_SECRET_ACCESS_KEY=$secret_key|" .env
        else
            echo "AWS_SECRET_ACCESS_KEY=$secret_key" >> .env
        fi
        
        echo ""
        echo -e "${GREEN}✓ .env file updated with AWS credentials${NC}"
        
        # Test credentials
        echo ""
        echo "Testing AWS credentials..."
        export AWS_ACCESS_KEY_ID=$access_key
        export AWS_SECRET_ACCESS_KEY=$secret_key
        
        if command -v aws &> /dev/null; then
            if aws sts get-caller-identity &> /dev/null; then
                echo -e "${GREEN}✓ AWS credentials are valid!${NC}"
            else
                echo -e "${RED}✗ AWS credentials test failed${NC}"
                echo "Please check your credentials and try again"
            fi
        else
            echo -e "${YELLOW}⚠ AWS CLI not installed - skipping credential test${NC}"
            echo "Your credentials have been saved to .env"
        fi
        ;;
        
    3)
        echo ""
        echo -e "${GREEN}Skipping AWS setup${NC}"
        echo ""
        echo "Your system will use PostgreSQL fallback mode (free)."
        echo "This works great for development and testing!"
        echo ""
        echo "You can set up AWS Bedrock later by running this script again."
        ;;
        
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo "================================================"
echo "Setup Complete!"
echo "================================================"
echo ""

if [ "$choice" != "3" ]; then
    echo "Next steps:"
    echo ""
    echo "1. Enable Bedrock model access:"
    echo "   - Go to: https://console.aws.amazon.com/bedrock/"
    echo "   - Click 'Model access' → 'Manage model access'"
    echo "   - Enable 'Claude Opus 4' and 'Claude 3.5 Sonnet'"
    echo "   - Wait 1-5 minutes for approval"
    echo ""
    echo "2. Test your setup:"
    echo "   npm run start:dev"
    echo ""
    echo "3. (Optional) Create Bedrock Knowledge Base:"
    echo "   See: WEEK3_AWS_BEDROCK_PLAN.md"
    echo ""
else
    echo "Your system is ready to use with PostgreSQL fallback!"
    echo ""
    echo "Start the server:"
    echo "  npm run start:dev"
    echo ""
    echo "Test a query:"
    echo "  curl -X POST http://localhost:3000/api/rag/query \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -d '{\"query\": \"What are Apple'\''s main risk factors?\"}'"
    echo ""
fi

echo "For detailed instructions, see: AWS_CREDENTIALS_SETUP_GUIDE.md"
echo ""
