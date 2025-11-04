/**
 * Cloudflare R2 Storage Service
 * Handles video uploads and streaming from Cloudflare R2
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Check if Cloudflare R2 is properly configured
 */
export function isR2Configured(): boolean {
  return !!(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.CLOUDFLARE_BUCKET_NAME &&
    process.env.CLOUDFLARE_ACCESS_KEY_ID &&
    process.env.CLOUDFLARE_SECRET_ACCESS_KEY
  );
}

/**
 * Initialize S3 client for Cloudflare R2
 */
function getR2Client() {
  if (!isR2Configured()) {
    throw new Error("Cloudflare R2 not configured");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY!,
    },
  });
}

/**
 * Upload file to Cloudflare R2
 */
export async function uploadFileToR2(
  key: string,
  fileBuffer: Buffer,
  contentType: string
): Promise<boolean> {
  try {
    console.log("Uploading to Cloudflare R2:", {
      key,
      contentType,
      size: fileBuffer.length,
    });

    const s3Client = getR2Client();

    const command = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_BUCKET_NAME!,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    });

    await s3Client.send(command);

    console.log("✅ FILE UPLOADED TO R2:", {
      key,
      bucket: process.env.CLOUDFLARE_BUCKET_NAME,
      size: fileBuffer.length,
    });

    return true;
  } catch (error) {
    console.error("❌ R2 upload error:", error);
    return false;
  }
}

/**
 * Generate signed URL for video streaming from Cloudflare R2
 */
export async function generateStreamUrl(
  key: string,
  expiresIn: number = 3600 // 1 hour
): Promise<string> {
  try {
    const s3Client = getR2Client();

    const command = new GetObjectCommand({
      Bucket: process.env.CLOUDFLARE_BUCKET_NAME!,
      Key: key,
    });

    const streamUrl = await getSignedUrl(s3Client, command, {
      expiresIn,
    });

    console.log("✅ R2 STREAM URL GENERATED:", {
      key,
      expiresIn,
      url: streamUrl.substring(0, 100) + "...",
    });

    return streamUrl;
  } catch (error) {
    console.error("❌ Failed to generate R2 stream URL:", error);
    throw error;
  }
}

/**
 * Generate presigned POST URL for direct upload to Cloudflare R2
 */
export async function generateUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600 // 1 hour
): Promise<{ url: string; fields: Record<string, string> }> {
  try {
    const s3Client = getR2Client();

    const command = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_BUCKET_NAME!,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn,
    });

    console.log("✅ R2 PRESIGNED UPLOAD URL GENERATED:", {
      key,
      contentType,
      expiresIn,
      url: presignedUrl.substring(0, 100) + "...",
    });

    return {
      url: presignedUrl,
      fields: {
        key,
        "Content-Type": contentType,
      },
    };
  } catch (error) {
    console.error("❌ Failed to generate R2 upload URL:", error);
    throw error;
  }
}

/**
 * Get R2 configuration status
 */
export function getR2Config() {
  return {
    configured: isR2Configured(),
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ? "***" : undefined,
    bucketName: process.env.CLOUDFLARE_BUCKET_NAME,
    hasAccessKey: !!process.env.CLOUDFLARE_ACCESS_KEY_ID,
    hasSecretKey: !!process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
  };
}
