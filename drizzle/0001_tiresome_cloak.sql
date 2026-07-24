CREATE TABLE `faceSwapJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sourceImageUrl` text NOT NULL,
	`targetVideoUrl` text NOT NULL,
	`outputVideoUrl` text,
	`akoolJobId` varchar(255),
	`status` enum('pending','queued','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`aspectRatio` enum('original','9:16') NOT NULL DEFAULT 'original',
	`visualStyle` enum('none','cinematic','vivid','soft','bw') NOT NULL DEFAULT 'none',
	`nsfwEnabled` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `faceSwapJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`jobId` int NOT NULL,
	`type` enum('email','in_app') NOT NULL,
	`notificationStatus` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`content` text NOT NULL,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`nsfwToggle` int NOT NULL DEFAULT 0,
	`emailNotifications` int NOT NULL DEFAULT 1,
	`inAppNotifications` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `userSettings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `faceSwapJobs` ADD CONSTRAINT `faceSwapJobs_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_jobId_faceSwapJobs_id_fk` FOREIGN KEY (`jobId`) REFERENCES `faceSwapJobs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `userSettings` ADD CONSTRAINT `userSettings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;