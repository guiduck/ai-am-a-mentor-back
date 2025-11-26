/**
 * Cloudflare R2 Storage Service
 * Handles video uploads and streaming from Cloudflare R2
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
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
 * Get file stream from R2 (for proxy streaming)
 */
export async function getR2FileStream(key: string): Promise<{
  Body: any; // Readable stream
  ContentType?: string;
  ContentLength?: number;
} | null> {
  try {
    console.log("📥 Fetching file from R2:", {
      key,
      bucket: process.env.CLOUDFLARE_BUCKET_NAME,
    });

    const s3Client = getR2Client();

    const command = new GetObjectCommand({
      Bucket: process.env.CLOUDFLARE_BUCKET_NAME!,
      Key: key,
    });

    const response = await s3Client.send(command);

    console.log("✅ R2 file stream retrieved:", {
      key,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      hasBody: !!response.Body,
    });

    return {
      Body: response.Body,
      ContentType: response.ContentType,
      ContentLength: response.ContentLength,
    };
  } catch (error: any) {
    console.error("❌ Failed to get R2 file stream:", {
      key,
      error: error.message,
      code: error.Code,
      statusCode: error.$metadata?.httpStatusCode,
    });
    return null;
  }
}

/**
 * Delete file from Cloudflare R2
 */
export async function deleteFileFromR2(key: string): Promise<boolean> {
  try {
    if (!isR2Configured()) {
      console.warn("⚠️ R2 not configured, skipping file deletion:", key);
      return false;
    }

    console.log("🗑️ Deleting file from R2:", {
      key,
      bucket: process.env.CLOUDFLARE_BUCKET_NAME,
    });

    const s3Client = getR2Client();

    const command = new DeleteObjectCommand({
      Bucket: process.env.CLOUDFLARE_BUCKET_NAME!,
      Key: key,
    });

    await s3Client.send(command);

    console.log("✅ File deleted from R2:", {
      key,
      bucket: process.env.CLOUDFLARE_BUCKET_NAME,
    });

    return true;
  } catch (error: any) {
    // Don't throw error if file doesn't exist (404)
    if (error.Code === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
      console.log(
        "ℹ️ File not found in R2 (already deleted or never existed):",
        key
      );
      return true; // Consider it successful since the goal is to have it deleted
    }

    console.error("❌ R2 delete error:", {
      key,
      error: error.message,
      code: error.Code,
      statusCode: error.$metadata?.httpStatusCode,
    });
    return false;
  }
}

/**
 * Download file from R2 as Buffer
 */
export async function downloadFileFromR2(key: string): Promise<Buffer | null> {
  try {
    console.log("📥 Downloading file from R2:", {
      key,
      bucket: process.env.CLOUDFLARE_BUCKET_NAME,
    });

    const s3Client = getR2Client();

    const command = new GetObjectCommand({
      Bucket: process.env.CLOUDFLARE_BUCKET_NAME!,
      Key: key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      console.error("❌ No body in R2 response:", key);
      return null;
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const stream = response.Body as any;

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);

    console.log("✅ File downloaded from R2:", {
      key,
      size: buffer.length,
      contentType: response.ContentType,
    });

    return buffer;
  } catch (error: any) {
    console.error("❌ Failed to download file from R2:", {
      key,
      error: error.message,
      code: error.Code,
      statusCode: error.$metadata?.httpStatusCode,
    });
    return null;
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
