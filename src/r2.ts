import { S3 } from "@aws-sdk/client-s3";

// Validate R2 configuration
if (!process.env.R2_ENDPOINT) {
  throw new Error('R2_ENDPOINT environment variable is required');
}
if (!process.env.R2_ACCESS_KEY_ID) {
  throw new Error('R2_ACCESS_KEY_ID environment variable is required');
}
if (!process.env.R2_SECRET_ACCESS_KEY) {
  throw new Error('R2_SECRET_ACCESS_KEY environment variable is required');
}
if (!process.env.R2_BUCKET) {
  throw new Error('R2_BUCKET environment variable is required');
}

// Remove protocol from endpoint if present (AWS SDK adds it automatically)
const endpoint = process.env.R2_ENDPOINT.replace(/^https?:\/\//, '');

if (!endpoint) {
  throw new Error('R2_ENDPOINT must contain a valid domain after removing protocol');
}

export const r2 = new S3({
  region: "auto",
  endpoint: `https://${endpoint}`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});
