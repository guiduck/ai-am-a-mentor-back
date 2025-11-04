const { S3Client, ListBucketsCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

async function testR2Connection() {
  try {
    console.log('☁️  Testing Cloudflare R2 connection...');
    
    const requiredEnvVars = [
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_ACCESS_KEY_ID', 
      'CLOUDFLARE_SECRET_ACCESS_KEY',
      'CLOUDFLARE_BUCKET_NAME'
    ];
    
    // Check environment variables
    const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }
    
    console.log('✅ All R2 environment variables found');
    console.log('Account ID:', process.env.CLOUDFLARE_ACCOUNT_ID);
    console.log('Bucket:', process.env.CLOUDFLARE_BUCKET_NAME);
    console.log('Access Key ID:', process.env.CLOUDFLARE_ACCESS_KEY_ID?.substring(0, 8) + '...');
    
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID,
        secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
      },
    });
    
    // Test connection with list buckets
    console.log('Testing R2 connection...');
    const listCommand = new ListBucketsCommand({});
    const buckets = await s3Client.send(listCommand);
    
    console.log('✅ R2 connection successful!');
    console.log('Available buckets:', buckets.Buckets?.map(b => b.Name) || []);
    
    // Test upload
    console.log('Testing file upload...');
    const testKey = `test-${Date.now()}.txt`;
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_BUCKET_NAME,
      Key: testKey,
      Body: 'Test upload from R2 connection script',
      ContentType: 'text/plain',
    });
    
    await s3Client.send(uploadCommand);
    console.log('✅ Test file uploaded successfully:', testKey);
    
  } catch (error) {
    console.error('❌ R2 connection failed:', error.message);
    if (error.name === 'CredentialsProviderError') {
      console.error('💡 Check your CLOUDFLARE_ACCESS_KEY_ID and CLOUDFLARE_SECRET_ACCESS_KEY');
    }
    process.exit(1);
  }
}

testR2Connection();
