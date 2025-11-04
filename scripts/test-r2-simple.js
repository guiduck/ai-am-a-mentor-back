const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

async function testR2Simple() {
  try {
    console.log('☁️  Simple R2 Test...');
    
    if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_ACCESS_KEY_ID || !process.env.CLOUDFLARE_SECRET_ACCESS_KEY) {
      throw new Error('Missing Cloudflare R2 credentials');
    }
    
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID,
        secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
      },
    });
    
    const testKey = `simple-test-${Date.now()}.txt`;
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_BUCKET_NAME,
      Key: testKey,
      Body: 'Simple R2 test',
      ContentType: 'text/plain',
    });
    
    await s3Client.send(uploadCommand);
    console.log('✅ R2 working! Uploaded:', testKey);
    
  } catch (error) {
    console.error('❌ R2 test failed:', error.message);
    process.exit(1);
  }
}

testR2Simple();
