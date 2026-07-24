# Akool Face Swap API - Research & Implementation Guide

## Authentication

**Recommended Method: Direct API Key**
- Obtain API Key from Akool dashboard (API Credentials section)
- Include in request header: `x-api-key: {API_KEY}`
- No token generation step required
- API Key is same as previous clientSecret value

**Legacy Method: ClientId/ClientSecret**
- POST to `/api/open/v3/getToken` with clientId and clientSecret
- Returns Bearer token valid for 1+ year
- Use token in header: `Authorization: Bearer {token}`

## API Endpoints

### Face Swap Plus (Recommended for video + multi-face)
- **Endpoint**: `POST /api/open/v4/faceswap/faceswapPlusByImage`
- **Supports**: Both images and videos
- **Features**: Multi-face swapping, single-face mode, face mapping
- **No pre-detection required** for single-face mode

### Face Swap Pro (Highest quality, image only)
- **Endpoint**: `POST /api/open/v4/faceswap/faceswapByImage`
- **Supports**: Images only
- **Features**: Highest quality single-face swap
- **No pre-detection required**

### Video Face Swap (V3)
- **Endpoint**: `POST /api/open/v3/faceswap/videoFaceswap`
- **Requires**: Face detection via Face Detect API first
- **Returns**: landmarks_str to pass as opts parameter

### Face Detect API
- **Endpoint**: `POST /api/open/v3/faceswap/faceDetect`
- **Purpose**: Detect faces and get landmark data
- **Required for**: V3 APIs (Image/Video Faceswap)
- **Returns**: landmarks_str for use in subsequent calls

## Pricing & Credits

- **Face Swap Image**: 4 credits per image
- **Face Swap Video**: 10 credits per 10 seconds
- **API Plans**: Starting at $0.029/credit (yearly billing)
- **Business Plan**: $249/month with 6,000 credits/month

## Webhook Integration

**Webhook Flow**:
1. Include `webhookUrl` parameter in face swap request
2. Akool sends callback when job completes
3. Callback includes encrypted data and signature

**Webhook Response Format**:
```json
{
  "signature": "sha1_hash_of_sorted_params",
  "dataEncrypt": "aes_encrypted_result",
  "timestamp": 1710757981609,
  "nonce": "1529"
}
```

**Decryption**:
- Use AES-CBC with clientSecret as key (24 bytes)
- Use clientId as IV (16 bytes)
- Verify signature: `sha1(sort(clientId, timestamp, nonce, dataEncrypt))`

**Decrypted Data Contains**:
- `_id`: Job ID
- `status`: 1=queuing, 2=processing, 3=completed, 4=failed
- `type`: "faceswap"
- `url`: Result URL when status=3

## Job Status Polling

**Get Result API**:
- **Endpoint**: `POST /api/open/v4/faceswap/getFaceswapResultList`
- **Parameters**: Pass result IDs to check
- **Response**: Returns status and result URL when complete
- **Status Values**: 1=queue, 2=processing, 3=success, 4=failed

## Request/Response Codes

| Code | Meaning |
|------|---------|
| 1000 | Success |
| 1003 | Parameter error |
| 1005 | Operation too frequent |
| 1006 | Quota not enough |
| 1007 | Too many faces (max 8) |
| 1101 | Invalid authorization |
| 1102 | Authorization empty |
| 1200 | Account banned |

## Best Practices

1. **Image Quality**: Use high-resolution, well-lit images with clear faces
2. **Video Duration**: Keep videos under 60 seconds for optimal processing
3. **Face Count**: Limit to 8 or fewer faces per video
4. **Video Encoding**: Use H.264 codec
5. **Face Enhancement**: Enable `face_enhance` for better quality (increases processing time)
6. **Result Cleanup**: Delete old results to keep account organized
7. **Rate Limiting**: Implement backoff for API calls

## Implementation Strategy for Face Swap Engine

1. **Backend Setup**:
   - Store Akool API key in environment variables
   - Create tRPC procedures for job submission
   - Implement webhook endpoint for job completion callbacks
   - Set up job polling as fallback if webhooks fail

2. **File Handling**:
   - Upload source image and target video to S3 first
   - Pass S3 URLs to Akool API (not local files)
   - Store result URLs in database when complete

3. **Aspect Ratio Conversion**:
   - Original: Use video as-is
   - 9:16: Crop/resize output video to portrait format

4. **Visual Filters**:
   - Apply post-processing filters to output video
   - Consider using FFmpeg for filter application
   - Options: cinematic, vivid, soft, B&W

5. **Error Handling**:
   - Implement retry logic for failed jobs
   - Store error messages in database
   - Notify user of failures

6. **Notifications**:
   - Send email when job completes
   - Send in-app notification
   - Include download link in notification
