#!/usr/bin/env node
/**
 * Generate Platform Admin API Key
 * 
 * Usage: node scripts/generate-admin-key.js
 * 
 * This generates a secure random API key for platform admin access.
 * Add the generated key to your .env file as PLATFORM_ADMIN_KEY
 * 
 * SECURITY NOTES:
 * - Keep this key secret - it provides full platform access
 * - Store in AWS Secrets Manager for production
 * - Rotate keys periodically
 * - Use different keys for different environments
 */

const crypto = require('crypto');

function generateAdminKey() {
  // Generate 32 bytes of random data (256 bits)
  const key = crypto.randomBytes(32).toString('hex');
  return key;
}

console.log('\n🔐 Platform Admin Key Generator\n');
console.log('Generated API Key:');
console.log('─'.repeat(70));
console.log(generateAdminKey());
console.log('─'.repeat(70));
console.log('\n📝 Add this to your .env file:');
console.log('   PLATFORM_ADMIN_KEY=<key-above>\n');
console.log('⚠️  SECURITY REMINDERS:');
console.log('   • Keep this key secret - it provides full platform access');
console.log('   • Use AWS Secrets Manager in production');
console.log('   • Use different keys for dev/staging/production');
console.log('   • Rotate keys periodically\n');
