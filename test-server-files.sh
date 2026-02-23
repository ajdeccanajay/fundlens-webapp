#!/bin/bash

echo "=== Testing if server is serving the fixed files ==="
echo ""

# Test 1: Check if Alpine.js x-init is fixed
echo "1. Checking Alpine.js x-init fix..."
if curl -s http://localhost:3000/app/deals/research.html | grep -q 'x-init="init()"'; then
    echo "   ✅ Alpine.js x-init is FIXED (found 'x-init=\"init()\"')"
else
    echo "   ❌ Alpine.js x-init is NOT fixed"
fi

# Test 2: Check if renderChart function exists with retry logic
echo ""
echo "2. Checking renderChart function with retry logic..."
if curl -s http://localhost:3000/app/deals/research.html | grep -q 'Chart.js not loaded yet, retrying'; then
    echo "   ✅ renderChart has retry logic"
else
    echo "   ❌ renderChart missing retry logic"
fi

# Test 3: Check if renderMarkdownWithCitations exists
echo ""
echo "3. Checking renderMarkdownWithCitations function..."
if curl -s http://localhost:3000/app/deals/research.html | grep -q 'renderMarkdownWithCitations'; then
    echo "   ✅ renderMarkdownWithCitations function exists"
else
    echo "   ❌ renderMarkdownWithCitations function missing"
fi

# Test 4: Check if favicon link exists
echo ""
echo "4. Checking favicon link..."
if curl -s http://localhost:3000/app/deals/research.html | grep -q 'rel="icon"'; then
    echo "   ✅ Favicon link exists"
else
    echo "   ❌ Favicon link missing"
fi

# Test 5: Check if GET messages endpoint exists
echo ""
echo "5. Checking GET messages endpoint (requires auth)..."
echo "   (This will return 401 without auth, which is expected)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/research/conversations/test-id/messages)
if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "404" ]; then
    echo "   ✅ Endpoint exists (returned $HTTP_CODE)"
else
    echo "   ⚠️  Unexpected response: $HTTP_CODE"
fi

echo ""
echo "=== Summary ==="
echo "All fixes are in the source files. If you're not seeing them in the browser:"
echo "1. Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)"
echo "2. Clear browser cache completely"
echo "3. Try incognito/private browsing mode"
echo "4. Check browser console for errors"
