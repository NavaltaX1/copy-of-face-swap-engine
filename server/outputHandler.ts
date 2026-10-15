/**
 * Output Handler - Downloads Replicate outputs and stores them in S3
 */

import { storagePut } from "./storage";

/**
 * Download file from URL and store in S3
 */
export async function downloadAndStoreOutput(
  sourceUrl: string,
  storagePath: string,
  contentType: string = "video/mp4"
): Promise<{ key: string; url: string }> {
  try {
    // Download the file from Replicate
    const response = await fetch(sourceUrl);

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    // Get the file as buffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Store in S3
    const result = await storagePut(storagePath, buffer, contentType);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download and store output: ${errorMessage}`);
  }
}

/**
 * Process completed face swap job - download output and store in S3
 */
export async function processCompletedJob(
  jobId: number,
  userId: number,
  replicateOutputUrl: string
): Promise<{ storagePath: string; storageUrl: string }> {
  const timestamp = Date.now();
  const storagePath = `outputs/face-swaps/${userId}/job-${jobId}-${timestamp}.mp4`;

  const result = await downloadAndStoreOutput(replicateOutputUrl, storagePath, "video/mp4");

  return {
    storagePath: result.key,
    storageUrl: result.url,
  };
}

/**
 * Get file size from URL (useful for validation).
 *
 * Returns null when the size cannot be determined - a failed HEAD request or a
 * response with no content-length. It used to return 0 for both, which made
 * every unknown size pass validateFileSize() as a 0-byte file.
 */
export async function getFileSizeFromUrl(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { method: "HEAD" });

    if (!response.ok) {
      console.error(`Failed to get file size for ${url}: ${response.status} ${response.statusText}`);
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (!contentLength) return null;

    const parsed = parseInt(contentLength, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    console.error("Error getting file size:", error);
    return null;
  }
}

/**
 * Validate file size (in bytes). An unknown size is not a valid size, so null
 * fails rather than passing by default.
 */
export function validateFileSize(sizeInBytes: number | null, maxSizeInMB: number): boolean {
  if (sizeInBytes === null) return false;
  const maxSizeInBytes = maxSizeInMB * 1024 * 1024;
  return sizeInBytes <= maxSizeInBytes;
}
