/**
 * Akool Face Swap API Integration
 * Handles all communication with Akool's Face Swap Plus API
 */

import { ENV } from "./_core/env";

interface AkoolFaceSwapRequest {
  source_url: string;
  target_url: string;
  model_style?: "realistic" | "anime";
  face_enhance?: boolean;
  single_face_mode?: boolean;
  webhookUrl?: string;
}

interface AkoolFaceSwapResponse {
  code: number;
  data?: {
    _id: string;
    status: number;
  };
  message?: string;
}

interface AkoolResultResponse {
  code: number;
  data?: Array<{
    _id: string;
    status: number;
    url?: string;
  }>;
}

/**
 * Submit a face swap job to Akool API
 */
export async function submitFaceSwapJob(
  sourceImageUrl: string,
  targetVideoUrl: string,
  options: {
    webhookUrl?: string;
    faceEnhance?: boolean;
    singleFaceMode?: boolean;
  } = {}
): Promise<{ jobId: string }> {
  const apiKey = process.env.AKOOL_API_KEY;
  if (!apiKey) {
    throw new Error("AKOOL_API_KEY environment variable not set");
  }

  const payload: AkoolFaceSwapRequest = {
    source_url: sourceImageUrl,
    target_url: targetVideoUrl,
    model_style: "realistic",
    face_enhance: options.faceEnhance ?? false,
    single_face_mode: options.singleFaceMode ?? true,
    webhookUrl: options.webhookUrl,
  };

  const response = await fetch(
    "https://openapi.akool.com/api/open/v4/faceswap/faceswapPlusByImage",
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Akool API error (${response.status}): ${errorText}`);
  }

  const data: AkoolFaceSwapResponse = await response.json();

  if (data.code !== 1000) {
    throw new Error(`Akool API returned error code ${data.code}: ${data.message}`);
  }

  if (!data.data?._id) {
    throw new Error("Akool API did not return a job ID");
  }

  return { jobId: data.data._id };
}

/**
 * Check the status of a face swap job
 */
export async function checkJobStatus(jobId: string): Promise<{
  status: "queued" | "processing" | "completed" | "failed";
  resultUrl?: string;
}> {
  const apiKey = process.env.AKOOL_API_KEY;
  if (!apiKey) {
    throw new Error("AKOOL_API_KEY environment variable not set");
  }

  const response = await fetch(
    "https://openapi.akool.com/api/open/v4/faceswap/getFaceswapResultList",
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ result_ids: [jobId] }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Akool API error (${response.status}): ${errorText}`);
  }

  const data: AkoolResultResponse = await response.json();

  if (data.code !== 1000) {
    throw new Error(`Akool API returned error code ${data.code}`);
  }

  const jobData = data.data?.[0];
  if (!jobData) {
    throw new Error("Job not found in Akool API response");
  }

  // Akool status: 1=queuing, 2=processing, 3=completed, 4=failed
  const statusMap: Record<number, "queued" | "processing" | "completed" | "failed"> = {
    1: "queued",
    2: "processing",
    3: "completed",
    4: "failed",
  };

  return {
    status: statusMap[jobData.status] || "processing",
    resultUrl: jobData.url,
  };
}

/**
 * Verify webhook signature from Akool
 */
export function verifyWebhookSignature(
  clientId: string,
  timestamp: string,
  nonce: string,
  dataEncrypt: string,
  signature: string
): boolean {
  const crypto = require("crypto");
  const sortedStr = [clientId, timestamp, nonce, dataEncrypt].sort().join("");
  const calculatedSignature = crypto.createHash("sha1").update(sortedStr).digest("hex");
  return calculatedSignature === signature;
}

/**
 * Decrypt webhook data from Akool
 */
export function decryptWebhookData(
  dataEncrypt: string,
  clientId: string,
  clientSecret: string
): any {
  const CryptoJS = require("crypto-js");

  const aesKey = clientSecret;
  const key = CryptoJS.enc.Utf8.parse(aesKey);
  const iv = CryptoJS.enc.Utf8.parse(clientId);

  const decrypted = CryptoJS.AES.decrypt(dataEncrypt, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
}
