#!/bin/bash

# Restart and Test Revenue Recognition Fix
# This script helps restart the server and run tests

echo "=================================================="
echo "Revenue Recognition Fix - Restart & Test"
echo "=================================================="
echo ""

# Check if server is running
echo "Checking if server is running..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Server is running on port 3000"
    echo ""
    echo "⚠️  You need to manually restart the server to apply the fix:"
    echo ""
    echo "   1. Go to the terminal where 'npm run start:dev' is running"
    echo "   2. Press Ctrl+C to stop the server"
    echo "   3. Run 'npm run start:dev' again"
    echo "   4. Wait for 'Nest application successfully started' message"
    echo "   5. Then run this script again to test"
    echo ""
    read -p "Have you restarted the server? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Please restart the server first, then run this script again."
        exit 1
    fi
else
    echo "❌ Server is not running"
    echo ""
    echo "Please start the server with:"
    echo "   npm run start:dev"
    echo ""
    exit 1
fi

echo ""
echo "Running tests..."
echo ""

# Run the test script
node scripts/test-revenue-recognition-fix.js

# Capture exit code
TEST_EXIT_CODE=$?

echo ""
echo "=================================================="
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "✅ All tests passed!"
    echo ""
    echo "Next steps:"
    echo "1. Test in browser: http://localhost:3000/workspace.html"
    echo "2. Click 'Research' tab"
    echo "3. Try: 'What is NVDA's revenue recognition policy?'"
else
    echo "⚠️  Some tests failed"
    echo ""
    echo "Troubleshooting:"
    echo "1. Make sure you restarted the server"
    echo "2. Check server logs for errors"
    echo "3. Verify NVDA data exists in database"
fi
echo "=================================================="

exit $TEST_EXIT_CODE
