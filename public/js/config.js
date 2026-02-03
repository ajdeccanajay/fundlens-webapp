/**
 * FundLens Frontend Configuration
 * 
 * This file provides environment-aware configuration for the frontend.
 * In production, API calls use relative paths (same origin).
 * In development, API calls go to localhost:3000.
 */

(function(window) {
  'use strict';

  // Detect environment based on hostname
  const hostname = window.location.hostname;
  const isProduction = hostname === 'app.fundlens.ai' || hostname === 'fundlens.ai';
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

  // Configuration object
  const config = {
    // Environment
    environment: isProduction ? 'production' : 'development',
    
    // API Base URL
    // In production: use relative paths (CloudFront routes /api/* to ALB)
    // In development: use localhost:3000
    apiBaseUrl: isProduction ? '' : 'http://localhost:3000',
    
    // Cognito Configuration
    cognito: {
      region: 'us-east-1',
      userPoolId: 'us-east-1_4OYqnpE18',
      clientId: '4s4k1usimlqkr6sk55gbva183s',
      // OAuth endpoints for production
      domain: isProduction ? 'auth.fundlens.ai' : null,
      redirectUri: isProduction ? 'https://app.fundlens.ai/callback' : 'http://localhost:3000/callback',
    },
    
    // Feature flags
    features: {
      enableDebugLogging: !isProduction,
      enableMockData: false,
    },
  };

  // Helper function to build API URLs
  config.apiUrl = function(path) {
    // Ensure path starts with /
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    return this.apiBaseUrl + path;
  };

  // Helper function to build API URLs with /api prefix
  config.api = function(endpoint) {
    // Ensure endpoint starts with /api
    if (!endpoint.startsWith('/api')) {
      endpoint = '/api' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    }
    return this.apiBaseUrl + endpoint;
  };

  // Expose configuration globally
  window.FundLensConfig = config;

  // Log configuration in development
  if (config.features.enableDebugLogging) {
    console.log('FundLens Configuration:', {
      environment: config.environment,
      apiBaseUrl: config.apiBaseUrl,
      hostname: hostname,
    });
  }

})(window);
