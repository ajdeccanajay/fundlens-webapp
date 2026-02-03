const { S3Client, CreateBucketCommand, PutBucketVersioningCommand, PutBucketEncryptionCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function createBucket() {
  const bucketName = process.env.S3_DATA_LAKE_BUCKET || 'fundlens-data-lake';
  const region = process.env.AWS_REGION || 'us-east-1';

  const s3Client = new S3Client({ region });

  try {
    console.log(`Creating S3 bucket: ${bucketName} in ${region}...`);

    // Create bucket
    try {
      await s3Client.send(new CreateBucketCommand({
        Bucket: bucketName
      }));
      console.log('✅ Bucket created successfully!');
    } catch (error) {
      if (error.name === 'BucketAlreadyOwnedByYou') {
        console.log('✅ Bucket already exists and is owned by you');
      } else if (error.name === 'BucketAlreadyExists') {
        console.log('⚠️  Bucket already exists');
      } else {
        throw error;
      }
    }

    // Enable versioning
    console.log('Enabling versioning...');
    await s3Client.send(new PutBucketVersioningCommand({
      Bucket: bucketName,
      VersioningConfiguration: {
        Status: 'Enabled'
      }
    }));
    console.log('✅ Versioning enabled');

    // Enable encryption
    console.log('Enabling encryption...');
    await s3Client.send(new PutBucketEncryptionCommand({
      Bucket: bucketName,
      ServerSideEncryptionConfiguration: {
        Rules: [{
          ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256'
          }
        }]
      }
    }));
    console.log('✅ Encryption enabled');

    console.log('\n🎉 S3 bucket setup complete!');
    console.log(`\nBucket: s3://${bucketName}`);
    console.log(`Region: ${region}`);
    console.log(`Versioning: Enabled`);
    console.log(`Encryption: AES256`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

createBucket();
