const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const s3 = new S3Client({ region: 'us-east-1' });

async function main() {
  let files = [];
  let token;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: 'fundlens-bedrock-chunks',
      Prefix: 'sections/',
      ContinuationToken: token,
    }));
    files.push(...(resp.Contents || []));
    token = resp.NextContinuationToken;
  } while (token);

  const txtFiles = files.filter(f => f.Key.endsWith('.txt') && !f.Key.endsWith('.metadata.json'));
  const metaFiles = files.filter(f => f.Key.endsWith('.metadata.json'));
  
  console.log('Total S3 objects:', files.length);
  console.log('Content files (.txt):', txtFiles.length);
  console.log('Metadata files (.metadata.json):', metaFiles.length);
  const totalMB = (txtFiles.reduce((s,f) => s + f.Size, 0) / 1024 / 1024).toFixed(1);
  console.log('Total content size:', totalMB, 'MB');
  console.log('');

  // Group by ticker
  const byTicker = {};
  for (const f of txtFiles) {
    const parts = f.Key.replace('sections/', '').split('/');
    const ticker = parts[0];
    if (!byTicker[ticker]) byTicker[ticker] = { count: 0, size: 0, filingTypes: new Set(), sections: [] };
    byTicker[ticker].count++;
    byTicker[ticker].size += f.Size;
    const fileName = parts[1] || '';
    const filingType = fileName.split('_')[0];
    if (filingType) byTicker[ticker].filingTypes.add(filingType);
    byTicker[ticker].sections.push(fileName);
  }

  console.log('Per-ticker breakdown:');
  for (const [ticker, data] of Object.entries(byTicker).sort((a,b) => a[0].localeCompare(b[0]))) {
    const kb = (data.size/1024).toFixed(0);
    const types = [...data.filingTypes].join(', ');
    console.log(`  ${ticker}: ${data.count} sections, ${kb} KB, filing types: ${types}`);
  }

  // Also check chunks/ prefix to confirm it's empty
  console.log('');
  const chunksResp = await s3.send(new ListObjectsV2Command({
    Bucket: 'fundlens-bedrock-chunks',
    Prefix: 'chunks/',
    MaxKeys: 10,
  }));
  console.log('chunks/ prefix objects remaining:', chunksResp.KeyCount || 0);
}
main().catch(console.error);
