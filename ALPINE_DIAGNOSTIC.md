# Alpine.js switchView Error Diagnostic

## Error
```
Alpine Expression Error: switchView is not defined
```

## Analysis

The `switchView` method IS defined in the `dealWorkspace()` function at line 2368:

```javascript
switchView(view) {
    this.currentView = view;
    window.location.hash = view;
    
    // Load scratchpad data when switching to scratchpad view
    if (view === 'scratchpad') {
        this.loadScratchpad();
    }
},
```

## Likely Causes

1. **Alpine.js initialization error**: There may be a JavaScript syntax error earlier in the `dealWorkspace()` function that prevents Alpine from properly initializing the component.

2. **Timing issue**: Alpine.js may not have fully initialized when the page loads.

3. **Scope issue**: The method might not be properly returned in the component object.

## Diagnostic Steps

### Step 1: Check Browser Console for JavaScript Errors
Open the browser console (F12) and look for:
- Syntax errors in the JavaScript
- Alpine.js initialization errors
- Any errors that occur before the "switchView is not defined" error

### Step 2: Verify Alpine.js is Loaded
In the browser console, type:
```javascript
window.Alpine
```
This should return the Alpine object. If it returns `undefined`, Alpine.js didn't load.

### Step 3: Check Component Initialization
In the browser console, type:
```javascript
Alpine.raw(document.querySelector('[x-data]').__x.$data)
```
This should show the component data. Check if `switchView` is listed as a method.

### Step 4: Test Manual Call
In the browser console, try:
```javascript
document.querySelector('[x-data]').__x.$data.switchView('research')
```
If this works, the method exists but there's an event binding issue.

## Quick Fix Attempt

The most likely issue is that there's a JavaScript syntax error preventing the component from initializing. Let me check for common issues:

1. Missing commas between methods
2. Unclosed brackets or parentheses
3. Syntax errors in async functions

## Recommended Solution

Since the method exists and is properly defined, the issue is likely:
1. A JavaScript error earlier in the file preventing Alpine initialization
2. The Alpine.js CDN not loading properly

### Immediate Fix
Add error handling and logging to the init function to see where it fails.
