# Replicate Face Swap API - Integration Guide

## Overview

Replicate provides easy-to-use face swap models via REST API with pay-as-you-go pricing. Free tier includes $5 monthly credits, no credit card required for signup.

## Recommended Models

### 1. **codeplugtech/face-swap** (Fastest & Most Cost-Effective)
- **Cost**: ~$0.0061 per run (163 runs per $1)
- **Speed**: Under 1 minute typically
- **Best for**: Quick prototyping, social content
- **Runs**: 2.5M+ runs on Replicate

### 2. **easel/advanced-face-swap** (Best Quality)
- **Cost**: Higher but commercial-grade quality
- **Speed**: Slower but more polished results
- **Best for**: Professional/commercial use
- **Features**: Multi-face support, better lighting preservation

### 3. **fofr/face-swap-with-ideogram** (Stylized)
- **Cost**: Variable based on style processing
- **Best for**: Character-driven, stylized results

## Authentication

**API Token**: Obtain from https://replicate.com/account/api-tokens
- Free tier: $5 monthly credits, no credit card required
- Add to header: `Authorization: Token {API_TOKEN}`

## API Workflow

### Submit a Prediction

**Endpoint**: `POST https://api.replicate.com/v1/predictions`

**Request**:
```json
{
  "version": "codeplugtech/face-swap:model-version-id",
  "input": {
    "source_image": "https://example.com/source.jpg",
    "target_image": "https://example.com/target.jpg"
  },
  "webhook": "https://yourdomain.com/api/webhooks/replicate",
  "webhook_events_filter": ["completed"]
}
```

**Response**:
```json
{
  "id": "ufawqhfynnngugvnn4nha",
  "version": "...",
  "urls": {
    "get": "https://api.replicate.com/v1/predictions/ufawqhfynnngugvnn4nha",
    "cancel": "https://api.replicate.com/v1/predictions/ufawqhfynnngugvnn4nha/cancel"
  },
  "created_at": "2024-01-01T00:00:00.000000Z",
  "started_at": null,
  "completed_at": null,
  "status": "starting",
  "input": {...},
  "output": null,
  "error": null,
  "logs": null
}
```

### Check Prediction Status

**Endpoint**: `GET https://api.replicate.com/v1/predictions/{prediction_id}`

**Response** (when complete):
```json
{
  "id": "ufawqhfynnngugvnn4nha",
  "status": "succeeded",
  "output": "https://replicate.delivery/output.jpg",
  "completed_at": "2024-01-01T00:05:00.000000Z"
}
```

## Status Values

- `starting` - Prediction is starting
- `processing` - Prediction is running
- `succeeded` - Prediction completed successfully
- `failed` - Prediction failed
- `canceled` - Prediction was canceled

## Pricing

- **Free Tier**: $5 monthly credits (no credit card required)
- **codeplugtech/face-swap**: ~$0.0061 per run
- **easel/advanced-face-swap**: ~$0.02-0.05 per run
- **Webhooks**: Included (no extra cost)

## Implementation Strategy

### File Upload Flow

1. **Frontend**: User selects source image and target image/video
2. **Frontend**: Upload files to S3 presigned URLs
3. **Backend**: Get S3 URLs for uploaded files
4. **Backend**: Submit prediction to Replicate with S3 URLs
5. **Backend**: Store prediction ID in database

### Job Processing Flow

1. **Backend**: Submit prediction to Replicate
2. **Backend**: Store prediction ID and status in database
3. **Option A - Webhooks**: Replicate sends webhook when complete
4. **Option B - Polling**: Backend polls Replicate every 5-10 seconds
5. **Backend**: When complete, download output from Replicate
6. **Backend**: Copy output to our S3 storage
7. **Backend**: Send notification to user
8. **Frontend**: Display download link

### Error Handling

- Validate file types (JPEG/PNG for images)
- Validate file sizes (< 10MB recommended)
- Implement retry logic for failed predictions
- Store error messages in database
- Handle Replicate API rate limiting

## Webhook Integration (Recommended)

Replicate sends webhook when prediction completes:

```json
{
  "id": "ufawqhfynnngugvnn4nha",
  "status": "succeeded",
  "output": "https://replicate.delivery/output.jpg"
}
```

**Webhook Endpoint**: `POST /api/webhooks/replicate`

Verify webhook signature:
```
X-Replicate-Content-SHA256: sha256 hash of request body
```

## Cost Estimation

For face swap operations:
- **Image-to-image swap**: ~$0.0061 (codeplugtech model)
- **Video processing**: Process frame-by-frame or use video-capable model
- **Free tier**: $5/month = ~820 image swaps

## Next Steps

1. Request Replicate API token from user
2. Implement prediction submission
3. Implement webhook or polling for status
4. Implement output file handling
5. Test with sample files
