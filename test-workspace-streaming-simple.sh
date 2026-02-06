#!/bin/bash

# Simple test to verify workspace streaming fix
# Tests that the HTML has the correct streaming logic

echo "🧪 Testing workspace.html streaming fix..."
echo ""

# Check 1: Verify streaming flag in template
echo "1️⃣ Checking template has streaming conditional..."
if grep -q 'x-show="!message.streaming"' public/app/deals/workspace.html && \
   grep -q 'x-show="message.streaming"' public/app/deals/workspace.html; then
    echo "   ✅ Template has streaming conditional rendering"
else
    echo "   ❌ Template missing streaming conditional"
    exit 1
fi

# Check 2: Verify streaming flag is set on message creation
echo "2️⃣ Checking streaming flag is initialized..."
if grep -q 'streaming: true' public/app/deals/workspace.html; then
    echo "   ✅ Streaming flag initialized to true"
else
    echo "   ❌ Streaming flag not initialized"
    exit 1
fi

# Check 3: Verify streaming flag is cleared on done
echo "3️⃣ Checking streaming flag is cleared on completion..."
if grep -q '.streaming = false' public/app/deals/workspace.html; then
    echo "   ✅ Streaming flag set to false on completion"
else
    echo "   ❌ Streaming flag not cleared"
    exit 1
fi

# Check 4: Verify backend has sentence splitting
echo "4️⃣ Checking backend has sentence splitting..."
if grep -q 'splitIntoSentences' src/research/research-assistant.service.ts; then
    echo "   ✅ Backend has sentence splitting logic"
else
    echo "   ❌ Backend missing sentence splitting"
    exit 1
fi

# Check 5: Verify renderMarkdown function exists
echo "5️⃣ Checking renderMarkdown function exists..."
if grep -q 'renderMarkdown(text)' public/app/deals/workspace.html; then
    echo "   ✅ renderMarkdown function exists"
else
    echo "   ❌ renderMarkdown function missing"
    exit 1
fi

echo ""
echo "✅ All static checks passed!"
echo ""
echo "📋 Manual testing required:"
echo "   1. Navigate to: http://localhost:3000/app/deals/workspace.html?ticker=GOOGL"
echo "   2. Click 'Research' tab"
echo "   3. Ask: 'What are the key risks for GOOGL?'"
echo "   4. Verify response streams completely without cutting off"
echo "   5. Verify markdown renders correctly after streaming completes"
echo ""
echo "See WORKSPACE_STREAMING_FIX_TEST.md for detailed test instructions"
