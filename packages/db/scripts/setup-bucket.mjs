// Creates the asset bucket and lets anyone read processed models (`models/*`) and nothing else
// (P5-02). Plain S3 calls, so it works on any S3-compatible store; safe to run again.
// Usage: node packages/db/scripts/setup-bucket.mjs   (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY)
import { CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand, S3Client } from '@aws-sdk/client-s3';

const { S3_ENDPOINT, S3_REGION = 'us-east-1', S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
if (!S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) throw new Error('S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are required');

const s3 = new S3Client({ endpoint: S3_ENDPOINT, region: S3_REGION, forcePathStyle: !!S3_ENDPOINT, credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY } });

for (let attempt = 1; ; attempt++) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    console.log(`bucket ${S3_BUCKET} exists`);
    break;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchBucket') {
      await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
      console.log(`bucket ${S3_BUCKET} created`);
      break;
    }
    if (attempt >= 20) throw err;
    await new Promise((r) => setTimeout(r, 1000)); // the store is still starting
  }
}

await s3.send(
  new PutBucketPolicyCommand({
    Bucket: S3_BUCKET,
    Policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [{ Sid: 'PublicModels', Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${S3_BUCKET}/models/*`] }],
    }),
  })
);
console.log(`anonymous reads allowed on ${S3_BUCKET}/models/*`);
