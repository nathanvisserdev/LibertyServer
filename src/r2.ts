import { S3 } from "@aws-sdk/client-s3";

// Remove protocol from endpoint if present (AWS SDK adds it automatically)
const endpoint = process.env.R2_ENDPOINT?.replace(/^https?:\/\//, '') || '';

export const r2 = new S3({
  region: "auto",
  endpoint: `https://${endpoint}`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
});
