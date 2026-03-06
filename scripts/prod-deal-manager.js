#!/usr/bin/env node
/**
 * Production Deal Manager
 * Authenticates via Cognito and manages deals on the production API.
 * 
 * Usage:
 *   node scripts/prod-deal-manager.js list
 *   node scripts/prod-deal-manager.js status ETSY
 *   node scripts/prod-deal-manager.js unstick <dealId>
 *   node scripts/prod-deal-manager.js create TICKER "Company Name"
 *   node scripts/prod-deal-manager.js analyze <dealId>
 *   node scripts/prod-deal-manager.js coverage <dealId>
 */

const crypto = require('crypto');
const https = require('https');

const CONFIG = {
  cognitoClientId: '4s4k1usimlqkr6sk55gbva183s',
  cognitoClientSecret: 'f52bpc2kg5j6dqua46d14o9bj5o796bakn4mnguiu9b1qusn8nh',
  cognitoRegion: 'us-east-1',
  username: '64981488-7091-7071-7150-459f03b52886',
  password: 'FundLens2024!',
  apiBase: 'https://app.fundlens.ai',
  tenantId: '00000000-0000-0000-0000-000000000000',
};

function computeSecretHash(username, clientId, clientSecret) {
  const hmac = crypto.createHmac('sha256', clientSecret);
  hmac.update(username + clientId);
  return hmac.digest('base64');
}

async function getToken() {
  const secretHash = computeSecretHash(CONFIG.username, CONFIG.cognitoClientId, CONFIG.cognitoClientSecret);
  
  const body = JSON.stringify({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CONFIG.cognitoClientId,
    AuthParameters: {
      USERNAME: CONFIG.username,
      PASSWORD: CONFIG.password,
      SECRET_HASH: secretHash,
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: `cognito-idp.${CONFIG.cognitoRegion}.amazonaws.com`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.AuthenticationResult) {
            // Use IdToken (not AccessToken) - it contains custom:tenant_id claims
            resolve(parsed.AuthenticationResult.IdToken);
          } else {
            reject(new Error(`Auth failed: ${JSON.stringify(parsed)}`));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function apiCall(method, path, token, body = null) {
  const url = new URL(path, CONFIG.apiBase);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-tenant-id': CONFIG.tenantId,
      },
    };
    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data.substring(0, 500) });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function listDeals(token) {
  const resp = await apiCall('GET', '/api/deals', token);
  if (resp.status !== 200) {
    console.log('Error:', resp.status, JSON.stringify(resp.data).substring(0, 300));
    return;
  }
  const deals = resp.data.deals || resp.data.data || resp.data || [];
  console.log(`\n📊 ${deals.length} deals found:\n`);
  console.log('ID'.padEnd(38) + 'Ticker'.padEnd(10) + 'Status'.padEnd(18) + 'Company');
  console.log('-'.repeat(90));
  for (const d of deals) {
    console.log(
      (d.id || '?').padEnd(38) +
      (d.ticker || '?').padEnd(10) +
      (d.status || '?').padEnd(18) +
      (d.companyName || '?')
    );
  }
  return deals;
}

async function getDealStatus(token, dealId) {
  const resp = await apiCall('GET', `/api/deals/${dealId}/pipeline-status`, token);
  console.log(`\nPipeline status for ${dealId}:`);
  console.log(JSON.stringify(resp.data, null, 2));
  return resp.data;
}

async function getDealByTicker(token, ticker) {
  const resp = await apiCall('GET', `/api/deals/by-ticker/${ticker}`, token);
  if (resp.status === 200 && resp.data.deal) {
    const d = resp.data.deal;
    console.log(`\n📋 Deal for ${ticker}:`);
    console.log(`  ID: ${d.id}`);
    console.log(`  Status: ${d.status}`);
    console.log(`  Company: ${d.companyName}`);
    console.log(`  Created: ${d.createdAt}`);
    return d;
  } else {
    console.log(`No deal found for ticker ${ticker}`);
    return null;
  }
}

async function unstickDeal(token, dealId) {
  // Update deal status to 'ready' to unstick it
  const resp = await apiCall('PUT', `/api/deals/${dealId}`, token, {
    status: 'ready',
  });
  console.log(`\nUnstick result (${resp.status}):`, JSON.stringify(resp.data).substring(0, 300));
  return resp.data;
}

async function createDeal(token, ticker, companyName) {
  const resp = await apiCall('POST', '/api/deals', token, {
    ticker: ticker.toUpperCase(),
    companyName,
    dealType: 'public',
    years: 5,
  });
  console.log(`\nCreate deal result (${resp.status}):`);
  console.log(JSON.stringify(resp.data, null, 2).substring(0, 500));
  return resp.data;
}

async function analyzeDeal(token, dealId) {
  const resp = await apiCall('POST', `/api/deals/${dealId}/analyze`, token);
  console.log(`\nAnalyze result (${resp.status}):`);
  console.log(JSON.stringify(resp.data, null, 2).substring(0, 500));
  return resp.data;
}

async function getDataCoverage(token, dealId) {
  const resp = await apiCall('GET', `/api/deals/${dealId}/data-coverage`, token);
  console.log(`\nData coverage (${resp.status}):`);
  console.log(JSON.stringify(resp.data, null, 2));
  return resp.data;
}

async function main() {
  const [,, command, ...args] = process.argv;
  
  if (!command) {
    console.log('Usage: node scripts/prod-deal-manager.js <command> [args]');
    console.log('Commands: list, status <ticker|id>, unstick <id>, create <ticker> <name>, analyze <id>, coverage <id>');
    process.exit(1);
  }

  console.log('🔐 Authenticating...');
  let token;
  try {
    token = await getToken();
    console.log('✅ Authenticated');
  } catch (e) {
    console.error('❌ Auth failed:', e.message);
    process.exit(1);
  }

  switch (command) {
    case 'list':
      await listDeals(token);
      break;
    case 'status': {
      const ticker = args[0];
      if (!ticker) { console.log('Usage: status <ticker|dealId>'); break; }
      // If it looks like a UUID, use directly; otherwise look up by ticker
      if (ticker.includes('-')) {
        await getDealStatus(token, ticker);
      } else {
        const deal = await getDealByTicker(token, ticker.toUpperCase());
        if (deal) await getDealStatus(token, deal.id);
      }
      break;
    }
    case 'unstick': {
      const dealId = args[0];
      if (!dealId) { console.log('Usage: unstick <dealId>'); break; }
      await unstickDeal(token, dealId);
      break;
    }
    case 'create': {
      const [ticker, ...nameParts] = args;
      const name = nameParts.join(' ');
      if (!ticker || !name) { console.log('Usage: create <ticker> <Company Name>'); break; }
      await createDeal(token, ticker, name);
      break;
    }
    case 'analyze': {
      const dealId = args[0];
      if (!dealId) { console.log('Usage: analyze <dealId>'); break; }
      await analyzeDeal(token, dealId);
      break;
    }
    case 'coverage': {
      const arg = args[0];
      if (!arg) { console.log('Usage: coverage <ticker|dealId>'); break; }
      if (arg.includes('-')) {
        await getDataCoverage(token, arg);
      } else {
        const deal = await getDealByTicker(token, arg.toUpperCase());
        if (deal) await getDataCoverage(token, deal.id);
      }
      break;
    }
    default:
      console.log(`Unknown command: ${command}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
