# Face Swap Engine - Project TODO

## Core Features

### Phase 1: Research & Architecture
- [x] Research Akool Face Swap API documentation and authentication
- [x] Research Magic Hour Face Swap API (free tier alternative)
- [x] Finalize technical architecture and API integration strategy
- [x] Document API workflow and error handling approach

### Phase 2: Database & Backend Setup
- [x] Design database schema for face swap jobs, users, and notifications
- [x] Create Drizzle ORM schema tables (jobs, notifications, user_settings)
- [x] Set up S3 integration for file uploads and output storage
- [x] Implement file upload procedures (source image, target video)
- [x] Create tRPC procedures for job submission and status checking
- [ ] Update backend to use Magic Hour API instead of Akool
- [ ] Implement webhook handling for Magic Hour API job completion callbacks

### Phase 3: Update Backend for Magic Hour API
- [ ] Replace Akool API integration with Magic Hour API
- [ ] Update job submission to use Magic Hour endpoints
- [ ] Implement Magic Hour webhook verification and decryption
- [ ] Update job status polling for Magic Hour API responses
- [ ] Request Magic Hour API key from user

### Phase 4: Frontend UI & Components
- [ ] Design cyberpunk color palette and typography system
- [ ] Create global CSS variables for neon colors and glow effects
- [ ] Build HUD-style layout components with corner brackets and technical lines
- [ ] Create upload form component (source image, target video, aspect ratio selector)
- [ ] Build processing status page with progress indicator
- [ ] Create job history page with status, thumbnail, and download links
- [ ] Implement NSFW toggle button component

### Phase 5: Face Swap Integration
- [ ] Integrate Akool Face Swap Plus API for image/video processing
- [ ] Implement aspect ratio conversion logic (original vs 9:16)
- [ ] Add visual style filters (cinematic, vivid, soft, B&W) as post-processing
- [ ] Handle API rate limiting and error responses
- [ ] Implement job polling for status updates

### Phase 6: Notifications & Features
- [ ] Set up email notification system for job completion
- [ ] Implement in-app notification system
- [ ] Create NSFW toggle functionality
- [ ] Add notification preferences to user settings
- [ ] Implement dual-channel notification delivery

### Phase 7: Testing & Optimization
- [ ] Write vitest unit tests for backend procedures
- [ ] Test file upload and S3 integration
- [ ] Test face swap API integration with sample files
- [ ] Verify notification delivery (email and in-app)
- [ ] Performance optimization and UI refinement
- [ ] Create checkpoint and prepare for deployment

## Technical Implementation Details

### Database Schema
- `faceSwapJobs`: id, userId, sourceImageUrl, targetVideoUrl, outputVideoUrl, status, aspectRatio, visualStyle, nsfwEnabled, createdAt, updatedAt, completedAt
- `notifications`: id, userId, jobId, type (email/in-app), status, sentAt, content
- `userSettings`: id, userId, nsfwToggle, emailNotifications, inAppNotifications

### API Procedures (tRPC)
- `jobs.submit`: Submit a new face swap job
- `jobs.list`: Retrieve user's job history
- `jobs.getStatus`: Get current status of a specific job
- `jobs.download`: Generate download link for completed job
- `settings.updateNsfwToggle`: Update NSFW preference
- `settings.getNsfwToggle`: Get current NSFW setting

### File Storage (S3)
- Source images: `/uploads/source-images/{userId}/{jobId}/{filename}`
- Target videos: `/uploads/target-videos/{userId}/{jobId}/{filename}`
- Output videos: `/outputs/{userId}/{jobId}/{filename}`

### External APIs
- Akool Face Swap Plus API for video/image face swapping
- Email service for notifications (via Manus built-in)
- Webhook endpoint for Akool job completion callbacks

## UI/UX Elements

### Cyberpunk Design System
- Primary colors: Deep black (#000000), Neon pink (#FF006E), Electric cyan (#00D9FF)
- Typography: Bold geometric sans-serif with outer glow effects
- Layout: HUD-style with corner brackets, technical lines, minimal borders
- Effects: Neon text glow, subtle animations, high contrast

### Pages
1. **Upload Page**: Source image selector, target video uploader, aspect ratio/style options, NSFW toggle
2. **Processing Page**: Real-time status indicator, progress bar, estimated time remaining
3. **Job History Page**: Table/grid of past jobs with status badges, thumbnails, download buttons
4. **Settings Page**: NSFW toggle, notification preferences

## Completed Items
(Items marked as complete will be listed here)

## Storage Requirements

- [x] Source images uploaded to S3
- [x] Target images uploaded to S3
- [ ] Download Replicate output videos and store in S3
- [ ] Serve all downloads from S3 (not external URLs)
- [ ] Implement output file download and storage in job completion handler


## Phase 5: Image-to-Video, Audio & Reference Video Support

- [ ] Update database schema to support audio and reference video URLs
- [ ] Create Replicate image-to-video model integration (e.g., Runway ML or similar)
- [ ] Implement audio upload and storage in S3
- [ ] Add reference video upload for duration/style matching
- [ ] Create backend procedure to combine face-swapped image + audio + reference video
- [ ] Update frontend upload form to accept audio and reference video files
- [ ] Implement audio preview in job history
- [ ] Test image-to-video conversion with audio integration
