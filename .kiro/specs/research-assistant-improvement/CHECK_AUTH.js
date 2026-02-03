// Authentication Diagnostic Script
// Copy and paste this into browser console to check authentication status

console.log('🔍 FundLens Authentication Diagnostic');
console.log('=====================================\n');

// Check for tokens
const fundlensToken = localStorage.getItem('fundlens_token');
const authToken = localStorage.getItem('authToken');

console.log('1. Token Check:');
if (fundlensToken) {
    console.log('   ✅ fundlens_token found');
    console.log('   Token preview:', fundlensToken.substring(0, 30) + '...');
    const parts = fundlensToken.split('.');
    console.log('   Token parts:', parts.length, parts.length === 3 ? '(Valid JWT format)' : '(Invalid JWT format)');
    
    // Try to decode JWT payload
    try {
        const payload = JSON.parse(atob(parts[1]));
        console.log('   Token payload:', payload);
        if (payload.exp) {
            const expDate = new Date(payload.exp * 1000);
            const now = new Date();
            console.log('   Expires:', expDate.toLocaleString());
            console.log('   Status:', now < expDate ? '✅ Valid' : '❌ Expired');
        }
    } catch (e) {
        console.log('   ⚠️  Could not decode token payload');
    }
} else if (authToken) {
    console.log('   ✅ authToken found');
    console.log('   Token preview:', authToken.substring(0, 30) + '...');
} else {
    console.log('   ❌ No authentication token found');
    console.log('   → You need to log in at /login.html');
}

console.log('\n2. Current Page:');
console.log('   URL:', window.location.href);
console.log('   Path:', window.location.pathname);

console.log('\n3. API Test:');
if (fundlensToken || authToken) {
    const token = fundlensToken || authToken;
    console.log('   Testing API call with token...');
    
    fetch('/api/deals/info?ticker=AAPL', {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        console.log('   Response status:', response.status);
        if (response.status === 200) {
            console.log('   ✅ Authentication working!');
            return response.json();
        } else if (response.status === 401) {
            console.log('   ❌ 401 Unauthorized - Token invalid or expired');
            console.log('   → Clear localStorage and log in again');
        } else {
            console.log('   ⚠️  Unexpected status:', response.status);
        }
        return null;
    })
    .then(data => {
        if (data) {
            console.log('   Deal info:', data);
        }
    })
    .catch(error => {
        console.log('   ❌ API call failed:', error.message);
    });
} else {
    console.log('   ⚠️  Skipping API test (no token)');
}

console.log('\n4. Recommended Actions:');
if (!fundlensToken && !authToken) {
    console.log('   1. Go to login page: window.location.href = "/login.html"');
    console.log('   2. Log in with valid credentials');
    console.log('   3. Return to workspace');
} else {
    console.log('   1. If you see 401 errors, clear localStorage: localStorage.clear()');
    console.log('   2. Then log in again');
    console.log('   3. Check Network tab for Authorization headers on API calls');
}

console.log('\n5. Quick Actions:');
console.log('   Clear localStorage: localStorage.clear()');
console.log('   Go to login: window.location.href = "/login.html"');
console.log('   Reload page: window.location.reload()');

console.log('\n=====================================');
console.log('Diagnostic complete. Check results above.');
