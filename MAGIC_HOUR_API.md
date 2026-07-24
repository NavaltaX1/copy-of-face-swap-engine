# Magic Hour Face Swap API - Integration Guide

## Overview

Magic Hour provides a free-tier Face Swap API with no credit card required. The API supports both image and video face swapping with a simple 3-step workflow.

## Authentication

**API Key**: Obtain from https://magichour.ai/settings/developer
- No credit card required
- Free credits included on signup
- Add to header: `Authorization: Bearer {API_KEY}`

## API Workflow

### Step 1: Generate Upload URLs

**Endpoint**: `POST /v1/files/generate-asset-upload-urls`

**Request**:
```json
{
  "assets": [
    {
      "file_name": "source.jpg",
      "file_size": 1024000,
      "file_type": "image/jpeg"
    },
    {
      "file_name": "target.mp4",
      "file_size": 5242880,
      "file_type": "video/mp4"
    }
  ]
}
```

**Response**:
```json
{
  "assets": [
    {
      "file_path": "api-assets/id/source.jpg",
      "upload_url": "https://s3.example.com/...",
      "file_type": "image/jpeg"
    },
    {
      "file_path": "api-assets/id/target.mp4",
      "upload_url": "https://s3.example.com/...",
      "file_type": "video/mp4"
    }
  ]
}
```

### Step 2: Upload Files to S3

Use the provided `upload_url` to PUT files directly to S3 with correct `Content-Type` header.

### Step 3: Submit Face Swap Job

**Endpoint**: `POST /v1/face-swap`

**Request**:
```json
{
  "name": "My Face Swap",
  "start_seconds": 0,
  "end_seconds": 15,
  "style": {
    "version": "default"
  },
  "assets": {
    "video_source": "file",
    "video_file_path": "api-assets/id/target.mp4",
    "image_file_path": "api-assets/id/source.jpg",
    "face_swap_mode": "all-faces"
  }
}
```

**Response**:
```json
{
  "id": "job_123",
  "status": "queued",
  "created_at": "2026-07-24T01:00:00Z"
}
```

### Step 4: Check Job Status

**Endpoint**: `GET /v1/projects/{job_id}`

**Response** (when complete):
```json
{
  "id": "job_123",
  "status": "complete",
  "downloads": [
    {
      "file_name": "output.mp4",
      "file_path": "api-assets/id/output.mp4",
      "file_size": 10485760
    }
  ]
}
```

## Job Status Values

- `queued` - Waiting to be processed
- `processing` - Currently being processed
- `complete` - Successfully completed
- `failed` - Processing failed

## Pricing & Credits

- **Free Tier**: Free credits on signup, no credit card required
- **Resolution**: Free users limited to 576px; higher plans unlock HD
- **Charges**: Only for frames that render; failed/cancelled jobs refund credits
- **Credits**: Roll over forever with no expiration

## Implementation Strategy

### File Upload Flow

1. **Client-side**: User selects source image and target video
2. **Frontend**: Send file metadata to backend
3. **Backend**: Call Magic Hour to get presigned upload URLs
4. **Frontend**: Upload files directly to S3 using presigned URLs
5. **Backend**: Receive notification that uploads are complete
6. **Backend**: Submit face swap job to Magic Hour with file paths

### Job Processing Flow

1. **Backend**: Submit job to Magic Hour API
2. **Backend**: Store job ID and status in database
3. **Backend**: Poll Magic Hour API for status updates (every 5-10 seconds)
4. **Backend**: When complete, copy output video to our S3 storage
5. **Backend**: Send notification to user
6. **Frontend**: Display download link

### Error Handling

- Validate file types (JPEG/PNG for images, MP4/WebM for videos)
- Validate file sizes (images < 10MB, videos < 500MB)
- Implement retry logic for failed API calls
- Store error messages in database for user display
- Handle Magic Hour API rate limiting (implement exponential backoff)

## Webhook Support (Optional)

Magic Hour supports webhooks for job completion notifications. Can be configured in dashboard, but polling is simpler for MVP.

## Cost Estimation

For a 15-second video at 576p:
- Approximately 450 frames
- Estimated cost: ~2-3 credits
- Free tier provides enough for testing

## Next Steps

1. Request Magic Hour API key from user
2. Implement file upload endpoints
3. Implement job submission and polling
4. Implement output file handling
5. Test with sample files
