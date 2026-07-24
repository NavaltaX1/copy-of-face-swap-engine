/**
 * Magic Hour Face Swap API Integration
 * Handles all communication with Magic Hour's Face Swap API (free tier)
 */

import { ENV } from "./_core/env";

const MAGIC_HOUR_API_BASE = "https://api.magichour.ai";

interface GenerateUploadUrlsRequest {
  assets: Array<{
    file_name: string;
    file_size: number;
    file_type: string;
  }>;
}

interface GenerateUploadUrlsResponse {
  assets: Array<{
    file_path: string;
    upload_url: string;
    file_type: string;
  }>;
}

interface SubmitFaceSwapRequest {
  name: string;
  start_seconds: number;
  end_seconds: number;
  style: {
    version: "v1" | "v2" | "default";
  };
  assets: {
    video_source: "file" | "youtube";
    video_file_path: string;
    image_file_path: string;
    face_swap_mode: "all-faces" | "individual-faces";
  };
}

interface SubmitFaceSwapResponse {
  id: string;
  status: string;
  created_at: string;
}

interface JobStatusResponse {
  id: string;
  status: "queued" | "processing" | "complete" | "failed";
  downloads?: Array<{
    file_name: string;
    file_path: string;
    file_size: number;
  }>;
  error?: string;
}

/**
 * Get presigned upload URLs for files
 */
export async function generateUploadUrls(
  files: Array<{ fileName: string; fileSize: number; fileType: string }>
): Promise<GenerateUploadUrlsResponse> {
  const apiKey = process.env.MAGIC_HOUR_API_KEY;
  if (!apiKey) {
    throw new Error("MAGIC_HOUR_API_KEY environment variable not set");
  }

  const payload: GenerateUploadUrlsRequest = {
    assets: files.map((f) => ({
      file_name: f.fileName,
      file_size: f.fileSize,
      file_type: f.fileType,
    })),
  };

  const response = await fetch(`${MAGIC_HOUR_API_BASE}/v1/files/generate-asset-upload-urls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Magic Hour API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Submit a face swap job
 */
export async function submitFaceSwapJob(
  sourceImagePath: string,
  targetVideoPath: string,
  options: {
    jobName?: string;
    startSeconds?: number;
    endSeconds?: number;
  } = {}
): Promise<{ jobId: string }> {
  const apiKey = process.env.MAGIC_HOUR_API_KEY;
  if (!apiKey) {
    throw new Error("MAGIC_HOUR_API_KEY environment variable not set");
  }

  const payload: SubmitFaceSwapRequest = {
    name: options.jobName || `Face Swap - ${new Date().toISOString()}`,
    start_seconds: options.startSeconds ?? 0,
    end_seconds: options.endSeconds ?? 15,
    style: {
      version: "default",
    },
    assets: {
      video_source: "file",
      video_file_path: targetVideoPath,
      image_file_path: sourceImagePath,
      face_swap_mode: "all-faces",
    },
  };

  const response = await fetch(`${MAGIC_HOUR_API_BASE}/v1/face-swap`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Magic Hour API error (${response.status}): ${errorText}`);
  }

  const data: SubmitFaceSwapResponse = await response.json();
  return { jobId: data.id };
}

/**
 * Check the status of a face swap job
 */
export async function checkJobStatus(jobId: string): Promise<JobStatusResponse> {
  const apiKey = process.env.MAGIC_HOUR_API_KEY;
  if (!apiKey) {
    throw new Error("MAGIC_HOUR_API_KEY environment variable not set");
  }

  const response = await fetch(`${MAGIC_HOUR_API_BASE}/v1/projects/${jobId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Magic Hour API error (${response.status}): ${errorText}`);
  }

  const data: JobStatusResponse = await response.json();
  return data;
}

/**
 * Upload file to presigned URL
 */
export async function uploadFileToPresignedUrl(
  presignedUrl: string,
  fileData: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  const response = await fetch(presignedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
    },
    body: fileData as any,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`File upload failed (${response.status}): ${errorText}`);
  }
}

/**
 * Get download URL for completed job output
 * Returns the Magic Hour file path that can be used to fetch the output
 */
export async function getJobOutput(jobId: string): Promise<{ outputPath: string; fileName: string } | null> {
  const jobStatus = await checkJobStatus(jobId);

  if (jobStatus.status !== "complete" || !jobStatus.downloads || jobStatus.downloads.length === 0) {
    return null;
  }

  // Find the main output video file
  const videoFile = jobStatus.downloads.find((d) => d.file_name.toLowerCase().endsWith(".mp4"));
  if (!videoFile) {
    return null;
  }

  return {
    outputPath: videoFile.file_path,
    fileName: videoFile.file_name,
  };
}
