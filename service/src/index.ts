import express from "express";
import cors from "cors";
import cron from "node-cron";
import { Automator, type AutomatorJob } from "./Automator.js";
import { EncryptionService } from "./EncryptionService.js";
import { z } from "zod";
import crypto from "crypto";
import { Base64, Bytes } from "ox";

// Environment variables with defaults for local development
const NODE_URL =
	process.env.NODE_URL || "https://a0a7-24-40-157-2.ngrok-free.app";
const ARTIFACT_SERVER_URL =
	process.env.ARTIFACT_SERVER_URL ||
	"https://registry.obsidion.xyz/download-artifacts";
const PORT = process.env.PORT || 3000;

// Validation schemas
const AccountSchema = z.object({
	address: z.string(),
	secretKey: z.string(),
	signingKey: z.string(),
});

const ScheduleSchema = z.object({
	start: z.string().datetime(),
	end: z.string().datetime(),
	interval: z.number().positive(), // interval in milliseconds
});

const RegisterJobSchema = z.object({
	txRequestStr: z.string(),
	account: AccountSchema,
	// contractAddress: z.string(),
	contractAddresses: z.array(z.string()),
	schedule: ScheduleSchema,
});

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Initialize Automator and EncryptionService
const automator = new Automator(ARTIFACT_SERVER_URL);
await automator.init(NODE_URL);
const encryptionService = new EncryptionService();

// Store for scheduled jobs with execution times
interface ScheduledJob {
	id: string;
	nextExecutionTime: Date;
	job: any; // AutomatorJob type
	isExecuting?: boolean; // Flag to prevent duplicate executions
}

const scheduledJobs: ScheduledJob[] = [];

// Helper function to add job to scheduled queue
function addJobToSchedule(job: AutomatorJob) {
	const { start, end, interval } = job.schedule;
	const startTime = new Date(start);
	const endTime = new Date(end);

	// Calculate all execution times
	const executionTimes: Date[] = [];
	let currentTime = new Date(startTime);

	while (currentTime <= endTime) {
		executionTimes.push(new Date(currentTime));
		currentTime = new Date(currentTime.getTime() + interval);
	}

	// Add each execution as a separate scheduled job
	executionTimes.forEach((executionTime, index) => {
		const scheduledJob: ScheduledJob = {
			id: `${job.id}_${index}`,
			nextExecutionTime: executionTime,
			job: {
				...job,
				originalId: job.id,
				executionIndex: index,
			},
		};

		scheduledJobs.push(scheduledJob);
	});

	// Sort by execution time
	scheduledJobs.sort(
		(a, b) => a.nextExecutionTime.getTime() - b.nextExecutionTime.getTime()
	);

	console.log(
		`Scheduled ${executionTimes.length} executions for job ${job.id}`
	);
}

// Helper function to execute a job
async function executeJob(scheduledJob: ScheduledJob) {
	// Prevent duplicate executions
	if (scheduledJob.isExecuting) {
		console.log(
			`Job ${scheduledJob.job.originalId} (execution ${scheduledJob.job.executionIndex}) is already executing, skipping`
		);
		return;
	}

	scheduledJob.isExecuting = true;

	try {
		console.log(
			`Executing job ${scheduledJob.job.originalId} (execution ${scheduledJob.job.executionIndex})`
		);

		const result = await automator.execute(scheduledJob.job.originalId);

		console.log(
			`Job ${scheduledJob.job.originalId} executed successfully:`,
			result
		);

		// Remove the executed job from the schedule
		const index = scheduledJobs.findIndex((job) => job.id === scheduledJob.id);
		if (index > -1) {
			scheduledJobs.splice(index, 1);
		}
	} catch (error) {
		console.error(
			`Failed to execute job ${scheduledJob.job.originalId}:`,
			error
		);

		// Remove failed job from schedule
		const index = scheduledJobs.findIndex((job) => job.id === scheduledJob.id);
		if (index > -1) {
			scheduledJobs.splice(index, 1);
		}
	} finally {
		scheduledJob.isExecuting = false;
	}
}

// Cron job that runs every 10 seconds to check for jobs to execute
cron.schedule("*/10 * * * * *", async () => {
	const now = new Date();
	const jobsToExecute: ScheduledJob[] = [];

	// Find jobs that should be executed now
	for (const scheduledJob of scheduledJobs) {
		if (scheduledJob.nextExecutionTime <= now && !scheduledJob.isExecuting) {
			jobsToExecute.push(scheduledJob);
		}
	}

	// Execute jobs sequentially to avoid race conditions
	for (const job of jobsToExecute) {
		console.log(
			`Cron: Executing job ${job.job.originalId} (execution ${job.job.executionIndex}) at ${now.toISOString()}`
		);
		await executeJob(job);
		// Add a small delay between executions to prevent overwhelming the system
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
});

// API Endpoints

// Health check endpoint
app.get("/health", (req: any, res: any) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Get encryption public key endpoint
app.get("/encryption-public-key", async (req: any, res: any) => {
	try {
		const publicKey = await encryptionService.getEncryptionPublicKey();
		res.json({ publicKey });
	} catch (error) {
		console.error("Error getting encryption public key:", error);
		res.status(500).json({
			error: "Internal server error",
			message: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

// Register a new job
app.post("/jobs", async (req: any, res: any) => {
	try {
		// Validate the encrypted data structure
		const encryptedDataSchema = z.object({
			data: z.string(), // Base64 encoded encrypted data
		});

		const { data: encryptedData } = encryptedDataSchema.parse(req.body);

		// Decrypt the data
		const decryptedBytes = await encryptionService.decrypt({
			data: Base64.toBytes(encryptedData),
		});

		// Parse the decrypted JSON data
		const decryptedJson = JSON.parse(Bytes.toString(decryptedBytes));
		const validatedData = RegisterJobSchema.parse(decryptedJson);

		// Generate a unique job id
		const jobId = crypto.randomUUID();

		// Convert schedule.start and schedule.end to Date objects
		const jobWithStatus: AutomatorJob = {
			id: jobId,
			...validatedData,
			schedule: {
				...validatedData.schedule,
				start: new Date(validatedData.schedule.start),
				end: new Date(validatedData.schedule.end),
			},
			status: "pending",
		};

		// Register the job with the automator
		await automator.registerJob(jobWithStatus);

		// Add to scheduled execution queue
		addJobToSchedule(jobWithStatus);

		res.status(201).json({
			message: "Job registered successfully",
			jobId,
			scheduledExecutions: scheduledJobs.filter(
				(job) => job.job.originalId === jobId
			).length,
		});
	} catch (error) {
		console.error("Error registering job:", error);

		if (error instanceof z.ZodError) {
			res.status(400).json({
				error: "Validation error",
				details: error.errors,
			});
		} else {
			res.status(500).json({
				error: "Internal server error",
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}
});

// Get all scheduled jobs
app.get("/jobs", (req: any, res: any) => {
	const jobs = scheduledJobs.map((scheduledJob) => ({
		id: scheduledJob.job.originalId,
		executionId: scheduledJob.id,
		executionIndex: scheduledJob.job.executionIndex,
		nextExecutionTime: scheduledJob.nextExecutionTime,
		status:
			scheduledJob.nextExecutionTime <= new Date() ? "overdue" : "scheduled",
	}));

	res.json({
		jobs,
		total: jobs.length,
	});
});

// Get a specific job
app.get("/jobs/:id", (req: any, res: any) => {
	const jobId = req.params.id;
	const jobExecutions = scheduledJobs.filter(
		(job) => job.job.originalId === jobId
	);

	if (jobExecutions.length === 0) {
		return res.status(404).json({ error: "Job not found" });
	}

	const job = jobExecutions[0]?.job;
	if (!job) {
		return res.status(404).json({ error: "Job not found" });
	}
	res.json({
		id: job.originalId,
		// contractAddress: job.contractAddress,
		contractAddresses: job.contractAddresses,
		schedule: job.schedule,
		executions: jobExecutions.map((exec) => ({
			executionId: exec.id,
			executionIndex: exec.job.executionIndex,
			nextExecutionTime: exec.nextExecutionTime,
			status: exec.nextExecutionTime <= new Date() ? "overdue" : "scheduled",
		})),
	});
});

// Cancel a job (remove all scheduled executions)
app.delete("/jobs/:id", (req: any, res: any) => {
	const jobId = req.params.id;
	const initialCount = scheduledJobs.length;

	// Remove all executions for this job
	const filteredJobs = scheduledJobs.filter(
		(job) => job.job.originalId !== jobId
	);
	const removedCount = initialCount - filteredJobs.length;

	// Replace the array
	scheduledJobs.length = 0;
	scheduledJobs.push(...filteredJobs);

	if (removedCount === 0) {
		return res.status(404).json({ error: "Job not found" });
	}

	res.json({
		message: "Job cancelled successfully",
		removedExecutions: removedCount,
	});
});

// Start the server
app.listen(PORT, () => {
	console.log(`🚀 Automator service running on port ${PORT}`);
	console.log(`🌐 Node URL: ${NODE_URL}`);
	console.log(`📦 Artifact Server URL: ${ARTIFACT_SERVER_URL}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
	console.log("SIGTERM received, shutting down gracefully...");
	process.exit(0);
});

process.on("SIGINT", () => {
	console.log("SIGINT received, shutting down gracefully...");
	process.exit(0);
});

process.on("uncaughtException", (err) => {
	console.error("Uncaught Exception:", err, err?.stack);
	process.exit(1);
});
process.on("unhandledRejection", (reason) => {
	console.error("Unhandled Rejection:", reason);
	process.exit(1);
});

console.log("Starting server...");
