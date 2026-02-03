#!/bin/bash

# Full Dataset Scaling Execution Script
# 
# This script orchestrates the complete scaling process from 5 to 10 companies
# with 7 years of historical data

set -e  # Exit on any error

echo "🚀 FundLens Full Dataset Scaling"
echo "================================="
echo ""
echo "Target: 10 companies × 7 years × 3 filing types"
echo "Companies: AAPL, MSFT, GOOGL, AMZN, TSLA, META, NVDA, JPM, BAC, WMT"
echo "Years: 2018-2025"
echo "Filing Types: 10-K, 10-Q, 8-K"
echo ""

# Check if services are running
echo "🔍 Checking system health..."
if ! curl -s http://localhost:3000/api/health > /dev/null; then
    echo "❌ Backend API not running. Please start with: npm run start:dev"
    exit 1
fi

if ! curl -s http://localhost:8000/health > /dev/null; then
    echo "❌ Python parser not running. Please start with: cd python_parser && python api_server.py"
    exit 1
fi

echo "✅ All services running"
echo ""

# Create logs directory
mkdir -p logs

# Function to run with logging
run_with_log() {
    local script_name=$1
    local log_file="logs/${script_name}-$(date +%Y%m%d-%H%M%S).log"
    
    echo "📋 Running $script_name..."
    echo "   Log: $log_file"
    
    if node "scripts/${script_name}.js" 2>&1 | tee "$log_file"; then
        echo "✅ $script_name completed successfully"
    else
        echo "❌ $script_name failed. Check log: $log_file"
        exit 1
    fi
    echo ""
}

# Parse command line arguments
SKIP_VALIDATION=false
COMPANIES=""
YEARS=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-validation)
            SKIP_VALIDATION=true
            shift
            ;;
        --companies=*)
            COMPANIES="${1#*=}"
            shift
            ;;
        --years=*)
            YEARS="${1#*=}"
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --skip-validation     Skip final validation step"
            echo "  --companies=LIST      Comma-separated list of companies (default: all 10)"
            echo "  --years=LIST         Comma-separated list of years (default: 2018-2025)"
            echo "  --help               Show this help"
            echo ""
            echo "Examples:"
            echo "  $0                                    # Full scaling"
            echo "  $0 --companies=META,NVDA             # Only new companies"
            echo "  $0 --years=2022,2023,2024           # Recent years only"
            echo "  $0 --skip-validation                 # Skip validation"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Build command arguments
SCALE_ARGS=""
if [[ -n "$COMPANIES" ]]; then
    SCALE_ARGS="$SCALE_ARGS --companies=$COMPANIES"
fi
if [[ -n "$YEARS" ]]; then
    SCALE_ARGS="$SCALE_ARGS --years=$YEARS"
fi

echo "🎯 Starting full dataset scaling process..."
echo "   Arguments: $SCALE_ARGS"
echo ""

# Step 1: Run the main scaling script
echo "📈 Step 1: Full Dataset Scaling"
echo "------------------------------"
if [[ -n "$SCALE_ARGS" ]]; then
    echo "📋 Running scale-full-dataset with custom arguments..."
    echo "   Log: logs/scale-full-dataset-$(date +%Y%m%d-%H%M%S).log"
    
    if node scripts/scale-full-dataset.js $SCALE_ARGS 2>&1 | tee "logs/scale-full-dataset-$(date +%Y%m%d-%H%M%S).log"; then
        echo "✅ scale-full-dataset completed successfully"
    else
        echo "❌ scale-full-dataset failed"
        exit 1
    fi
else
    run_with_log "scale-full-dataset"
fi

# Step 2: Validate the scaled dataset (optional)
if [[ "$SKIP_VALIDATION" == "false" ]]; then
    echo "✅ Step 2: Dataset Validation"
    echo "----------------------------"
    run_with_log "validate-full-dataset"
else
    echo "⏭️ Step 2: Skipping validation (--skip-validation flag)"
    echo ""
fi

# Step 3: Generate summary report
echo "📊 Step 3: Summary Report"
echo "------------------------"

echo "📋 Generating scaling summary..."

# Check if reports exist
SCALING_REPORT="full-dataset-scaling-report.json"
VALIDATION_REPORT="full-dataset-validation-report.json"

if [[ -f "$SCALING_REPORT" ]]; then
    echo "✅ Scaling report found: $SCALING_REPORT"
    
    # Extract key metrics from scaling report
    TOTAL_COMPANIES=$(node -e "const r=require('./$SCALING_REPORT'); console.log(r.results?.summary?.successfulCompanies || 0)")
    TOTAL_METRICS=$(node -e "const r=require('./$SCALING_REPORT'); console.log(r.results?.summary?.totalMetrics || 0)")
    TOTAL_NARRATIVES=$(node -e "const r=require('./$SCALING_REPORT'); console.log(r.results?.summary?.totalNarratives || 0)")
    PROCESSING_TIME=$(node -e "const r=require('./$SCALING_REPORT'); console.log(Math.round((r.results?.summary?.processingTime || 0)/60000))")
    
    echo ""
    echo "📊 Scaling Results:"
    echo "   Companies processed: $TOTAL_COMPANIES"
    echo "   Total metrics: $TOTAL_METRICS"
    echo "   Total narratives: $TOTAL_NARRATIVES"
    echo "   Processing time: ${PROCESSING_TIME} minutes"
else
    echo "⚠️ Scaling report not found"
fi

if [[ -f "$VALIDATION_REPORT" && "$SKIP_VALIDATION" == "false" ]]; then
    echo "✅ Validation report found: $VALIDATION_REPORT"
    
    # Extract validation results
    VALIDATION_PASSED=$(node -e "const r=require('./$VALIDATION_REPORT'); console.log(r.validation?.passed || false)")
    VALIDATION_SCORE=$(node -e "const r=require('./$VALIDATION_REPORT'); console.log(r.validation?.score?.toFixed(1) || 'N/A')")
    ISSUES_COUNT=$(node -e "const r=require('./$VALIDATION_REPORT'); console.log(r.validation?.issues || 0)")
    
    echo ""
    echo "✅ Validation Results:"
    echo "   Validation passed: $VALIDATION_PASSED"
    echo "   Overall score: ${VALIDATION_SCORE}%"
    echo "   Issues found: $ISSUES_COUNT"
fi

echo ""
echo "🎉 Full Dataset Scaling Complete!"
echo "================================="
echo ""
echo "📁 Generated Files:"
echo "   📊 full-dataset-scaling-report.json"
if [[ "$SKIP_VALIDATION" == "false" ]]; then
    echo "   ✅ full-dataset-validation-report.json"
fi
echo "   📋 logs/ directory with detailed logs"
echo ""
echo "🚀 Next Steps:"
echo "   1. Review the scaling and validation reports"
echo "   2. Test the system with advanced queries"
echo "   3. Consider production deployment"
echo ""
echo "🔗 Test the system:"
echo "   Frontend: http://localhost:3000/fundlens-main.html"
echo "   API Docs: http://localhost:3000/docs"
echo ""

# Test a sample query to verify everything works
echo "🧪 Quick System Test:"
echo "   Testing sample query..."

if curl -s -X POST http://localhost:3000/api/rag/query \
    -H "Content-Type: application/json" \
    -d '{"query": "What was Apple'\''s revenue in 2024?"}' | jq -r '.answer' | head -3; then
    echo "✅ System test passed - RAG queries working"
else
    echo "⚠️ System test failed - check the logs"
fi

echo ""
echo "🎊 Scaling process completed successfully!"