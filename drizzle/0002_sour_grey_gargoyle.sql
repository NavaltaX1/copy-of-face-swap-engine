ALTER TABLE `faceSwapJobs` MODIFY COLUMN `targetVideoUrl` text;--> statement-breakpoint
ALTER TABLE `faceSwapJobs` ADD `referenceVideoUrl` text;--> statement-breakpoint
ALTER TABLE `faceSwapJobs` ADD `audioUrl` text;