import React, { useEffect, useState } from "react";
import {
	ActionIcon,
	Button,
	CopyButton,
	Loader,
	Select,
	Stack,
	Text,
	TextInput,
	Tooltip,
	Card,
	Group,
	Badge,
	Modal,
	Alert,
	CheckIcon,
} from "@mantine/core";
import {
	AccountWallet,
	AztecAddress,
	createAztecNodeClient,
	createLogger,
	createPXEClient,
	Fq,
	Fr,
	type Logger,
	type PXE,
} from "@aztec/aztec.js";
import { createPXEService, getPXEServiceConfig } from "@aztec/pxe/client/lazy";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { getSchnorrAccount, getSchnorrWallet } from "@aztec/accounts/schnorr";
import { formatUnits, parseUnits } from "viem";
import { AutomatorClient, type AutomatorJob } from "aztec-automator";
import { getFee, getTokenTransferTxRequest } from "./utils";

const NODE_URL = "http://localhost:8080";
const AUTOMATOR_URL =
	"https://36c3486d890878aa7f6bbf9aeb6fbba91c22e7de-3000.dstack-prod8.phala.network";

type TokenType = {
	address: string;
	name: string;
	symbol: string;
	decimals: number;
};

type AccountInfo = {
	address: string;
	secretKey: string;
	signingKey: string;
};

type PaymentJob = {
	id: string;
	executionId: string;
	executionIndex: number;
	nextExecutionTime: string;
	status: "scheduled" | "completed";
};

type FrequencyOption = {
	value: string;
	label: string;
	intervalMs: number;
};

const FREQUENCY_OPTIONS: FrequencyOption[] = [
	{ value: "20s", label: "20 seconds", intervalMs: 20000 },
	{ value: "1min", label: "1 minute", intervalMs: 60000 },
	{ value: "1hr", label: "1 hour", intervalMs: 3600000 },
	{ value: "1day", label: "1 day", intervalMs: 86400000 },
	{ value: "1month", label: "1 month", intervalMs: 2592000000 },
];

export function RecurringPaymentApp() {
	const [pxe, setPxe] = useState<PXE | null>(null);
	const [account, setAccount] = useState<AccountWallet | null>(null);
	const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
	const [tokenContract, setTokenContract] = useState<TokenContract | null>(
		null
	);
	const [token, setToken] = useState<TokenType | null>(null);
	const [privateBalance, setPrivateBalance] = useState<string | null>(null);

	// Form states
	const [recipient, setRecipient] = useState<string>("");
	const [amount, setAmount] = useState<string>("");
	const [frequency, setFrequency] = useState<string>("20s");
	const [numberOfPayments, setNumberOfPayments] = useState<string>("5");

	// UI states
	const [loading, setLoading] = useState<boolean>(false);
	const [loadingBalances, setLoadingBalances] = useState<boolean>(false);
	const [loadingJobs, setLoadingJobs] = useState<boolean>(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [paymentJobs, setPaymentJobs] = useState<PaymentJob[]>([]);
	const [allSeenJobs, setAllSeenJobs] = useState<Set<string>>(new Set()); // Track all execution IDs we've seen

	// Local storage key for completed jobs
	const COMPLETED_JOBS_KEY = "completedPaymentJobs";

	// Helper function to get completed jobs from localStorage
	const getCompletedJobs = (): PaymentJob[] => {
		try {
			const stored = localStorage.getItem(COMPLETED_JOBS_KEY);
			return stored ? JSON.parse(stored) : [];
		} catch (e) {
			console.error("Error reading completed jobs from localStorage:", e);
			return [];
		}
	};

	// Helper function to save completed jobs to localStorage
	const saveCompletedJobs = (jobs: PaymentJob[]) => {
		try {
			console.log("Saving to localStorage with key:", COMPLETED_JOBS_KEY);
			console.log("Jobs to save:", jobs);
			localStorage.setItem(COMPLETED_JOBS_KEY, JSON.stringify(jobs));
			console.log("Successfully saved to localStorage");
		} catch (e) {
			console.error("Error saving completed jobs to localStorage:", e);
		}
	};

	// Helper function to add a job to completed jobs
	const addToCompletedJobs = (job: PaymentJob) => {
		console.log("Adding job to completed jobs:", job);
		const completedJobs = getCompletedJobs();
		// Check if job already exists to avoid duplicates
		const exists = completedJobs.some(
			(existingJob) => existingJob.executionId === job.executionId
		);
		if (!exists) {
			completedJobs.push(job);
			console.log("Saving completed jobs to localStorage:", completedJobs);
			saveCompletedJobs(completedJobs);
		} else {
			console.log("Job already exists in completed jobs, skipping");
		}
	};

	// Helper function to clear completed jobs (for cleanup)
	const clearCompletedJobs = () => {
		localStorage.removeItem(COMPLETED_JOBS_KEY);
	};

	// Debug function to check localStorage
	const debugLocalStorage = () => {
		console.log("=== DEBUG LOCALSTORAGE ===");
		console.log("All localStorage keys:", Object.keys(localStorage));
		console.log(
			"completedPaymentJobs value:",
			localStorage.getItem(COMPLETED_JOBS_KEY)
		);
		console.log("Parsed completed jobs:", getCompletedJobs());
		console.log("Current paymentJobs state:", paymentJobs);
		console.log("All seen jobs:", Array.from(allSeenJobs));
		console.log("==========================");
	};

	// Test function to manually add a completed job
	const testAddCompletedJob = () => {
		const testJob: PaymentJob = {
			id: "test-job-123",
			executionId: "test-execution-456",
			executionIndex: 0,
			nextExecutionTime: new Date().toISOString(),
			status: "completed",
		};
		console.log("Testing with job:", testJob);
		addToCompletedJobs(testJob);
		fetchPaymentJobs(); // Refresh to show the test job
	};

	// Calculate total transfer amount and completion date
	const totalAmount =
		amount && numberOfPayments
			? parseFloat(amount) * parseInt(numberOfPayments)
			: 0;
	const frequencyOption = FREQUENCY_OPTIONS.find((f) => f.value === frequency);
	const lastPaymentDate =
		frequencyOption && numberOfPayments
			? new Date(
					Date.now() +
						10000 +
						frequencyOption.intervalMs * parseInt(numberOfPayments)
			  )
			: null;

	// Check if amount exceeds balance
	const amountExceedsBalance =
		privateBalance && amount
			? parseFloat(amount) * parseInt(numberOfPayments) >
			  parseFloat(privateBalance)
			: false;

	// Initialize PXE
	useEffect(() => {
		const initPXE = async () => {
			try {
				const node = createAztecNodeClient(NODE_URL);
				const config = getPXEServiceConfig();
				config.dataDirectory = "pxe-data";
				config.proverEnabled = false;

				const logger = createLogger("pxe");
				const pxeClient = await createPXEService(node, config, {});
				setPxe(pxeClient as PXE);
			} catch (e) {
				setError("Failed to connect to PXE: " + e);
			}
		};
		initPXE();
	}, []);

	// Initialize or recover account
	useEffect(() => {
		const initAccount = async () => {
			if (!pxe) return;

			try {
				// Try to recover account from localStorage
				const storedAccountInfo = localStorage.getItem("accountInfo");
				if (storedAccountInfo) {
					const accountInfo: AccountInfo = JSON.parse(storedAccountInfo);
					setAccountInfo(accountInfo);

					// Recover account wallet
					const accountWallet = await getSchnorrWallet(
						pxe,
						AztecAddress.fromString(accountInfo.address),

						Fq.fromString(accountInfo.signingKey)
					);
					setAccount(accountWallet);
				} else {
					// Deploy new account
					await deployNewAccount();
				}
			} catch (e) {
				console.error("Error initializing account:", e);
				setError("Failed to initialize account: " + e);
			}
		};

		initAccount();
	}, [pxe]);

	// Initialize or deploy token
	useEffect(() => {
		const initToken = async () => {
			if (!account || !pxe) return;

			try {
				// Try to recover token from localStorage
				const storedToken = localStorage.getItem("token");
				if (storedToken) {
					const tokenData: TokenType = JSON.parse(storedToken);
					setToken(tokenData);

					// Initialize token contract
					const contract = await TokenContract.at(
						AztecAddress.fromString(tokenData.address),
						account
					);
					setTokenContract(contract);
				} else {
					// Deploy new token
					await deployNewToken();
				}
			} catch (e) {
				console.error("Error initializing token:", e);
				setError("Failed to initialize token: " + e);
			}
		};

		initToken();
	}, [account, pxe]);

	// Fetch balances when account and token are ready
	useEffect(() => {
		if (account && tokenContract && token) {
			fetchBalances();
		}
	}, [account, tokenContract, token]);

	// Fetch payment jobs periodically
	useEffect(() => {
		if (account) {
			fetchPaymentJobs();
			const interval = setInterval(fetchPaymentJobs, 10000); // Refresh every 10 seconds
			return () => clearInterval(interval);
		}
	}, [account]);

	const deployNewAccount = async () => {
		if (!pxe) return;

		setLoading(true);
		try {
			const secretKey = Fr.random();
			const signingKey = Fq.random();

			const accountWallet = await (
				await getSchnorrAccount(pxe, secretKey, signingKey)
			)
				.deploy({
					fee: await getFee(pxe),
					skipPublicDeployment: false,
				})
				.getWallet();

			const accountInfo: AccountInfo = {
				address: accountWallet.getAddress().toString(),
				secretKey: secretKey.toString(),
				signingKey: signingKey.toString(),
			};

			setAccount(accountWallet as AccountWallet);
			setAccountInfo(accountInfo);
			localStorage.setItem("accountInfo", JSON.stringify(accountInfo));

			setSuccess("New account deployed successfully!");
		} catch (e) {
			setError("Failed to deploy account: " + e);
		} finally {
			setLoading(false);
		}
	};

	const deployNewToken = async () => {
		if (!account || !pxe) return;

		setLoading(true);
		try {
			const deployTx = await TokenContract.deploy(
				account,
				account.getAddress(),
				"DAI",
				"Dai Stablecoin",
				9
			)
				.send({
					fee: await getFee(pxe),
				})
				.wait({
					timeout: 200000,
				});

			const contract = await TokenContract.at(
				deployTx.contract.address,
				account
			);
			setTokenContract(contract);

			const tokenData: TokenType = {
				address: contract.address.toString(),
				name: "Dai Stablecoin",
				symbol: "DAI",
				decimals: 9,
			};

			setToken(tokenData);
			localStorage.setItem("token", JSON.stringify(tokenData));

			// Mint tokens to the account
			await contract.methods
				.mint_to_private(account.getAddress(), account.getAddress(), 1000e9)
				.send({
					fee: await getFee(pxe),
				})
				.wait();

			setSuccess("New DAI token deployed and minted successfully!");
		} catch (e) {
			setError("Failed to deploy token: " + e);
		} finally {
			setLoading(false);
		}
	};

	const fetchBalances = async () => {
		if (!account || !tokenContract || !token) return;

		console.log("tokenContract: ", tokenContract.address.toString());
		console.log("account: ", account.getAddress().toString());

		setLoadingBalances(true);
		try {
			const privateBalance = await tokenContract.methods
				.balance_of_private(account.getAddress())
				.simulate();

			setPrivateBalance(formatUnits(privateBalance as bigint, token.decimals));
		} catch (e) {
			console.error("Error fetching balances:", e);
		} finally {
			setLoadingBalances(false);
		}
	};

	const fetchPaymentJobs = async () => {
		if (!account) return;

		setLoadingJobs(true);
		try {
			const response = await fetch(`${AUTOMATOR_URL}/jobs`);
			if (response.ok) {
				const data = await response.json();
				// Get server jobs (these are only scheduled jobs)
				const serverJobs = data.jobs || [];
				console.log("Server jobs:", serverJobs);

				// Get locally stored completed jobs
				const completedJobs = getCompletedJobs();
				console.log("Completed jobs from localStorage:", completedJobs);

				// Update our tracking of all seen jobs
				const currentExecutionIds = new Set(
					serverJobs.map((job: any) => job.executionId)
				);
				const newSeenJobs = new Set(allSeenJobs);
				serverJobs.forEach((job: any) => newSeenJobs.add(job.executionId));
				setAllSeenJobs(newSeenJobs);

				// Find jobs that were previously seen but are no longer on server (completed)
				const newlyCompletedJobs: PaymentJob[] = [];
				allSeenJobs.forEach((executionId) => {
					if (!currentExecutionIds.has(executionId)) {
						// This job was previously seen but is no longer on server
						// Check if it's not already in completed jobs
						const alreadyCompleted = completedJobs.some(
							(job) => job.executionId === executionId
						);
						if (!alreadyCompleted) {
							// Find the job details from previous state or create a placeholder
							const previousJob = paymentJobs.find(
								(job) => job.executionId === executionId
							);
							if (previousJob) {
								const completedJob = {
									...previousJob,
									status: "completed" as const,
								};
								newlyCompletedJobs.push(completedJob);
								console.log("Detected newly completed job:", completedJob);
							}
						}
					}
				});

				// Add newly completed jobs to localStorage
				newlyCompletedJobs.forEach((job) => {
					addToCompletedJobs(job);
				});

				// Get updated completed jobs after adding new ones
				const updatedCompletedJobs = getCompletedJobs();
				console.log("Updated completed jobs:", updatedCompletedJobs);

				// Merge server jobs with locally stored completed jobs
				const allJobs = [...serverJobs, ...updatedCompletedJobs];

				// Remove duplicates (in case a job appears in both arrays)
				const uniqueJobs = allJobs.filter(
					(job, index, self) =>
						index === self.findIndex((j) => j.executionId === job.executionId)
				);

				console.log("Final jobs to display:", uniqueJobs);
				setPaymentJobs(uniqueJobs);
			} else {
				// If server request fails, still show completed jobs from localStorage
				const completedJobs = getCompletedJobs();
				setPaymentJobs(completedJobs);
			}
		} catch (e) {
			console.error("Error fetching payment jobs:", e);
			// If there's an error, still show completed jobs from localStorage
			const completedJobs = getCompletedJobs();
			setPaymentJobs(completedJobs);
		} finally {
			setLoadingJobs(false);
		}
	};

	const handleCreateRecurringPayment = async () => {
		if (!account || !tokenContract || !token || !pxe) {
			setError("Account or token not initialized");
			return;
		}

		if (!recipient || !amount || !frequency || !numberOfPayments) {
			setError("Please fill in all fields");
			return;
		}

		setLoading(true);
		setError(null);

		try {
			// Validate recipient address
			const recipientAddress = AztecAddress.fromString(recipient);
			const amountInWei = parseUnits(amount, token.decimals);

			// Create transaction request using the helper function from utils
			const txRequest = await getTokenTransferTxRequest(
				pxe,
				account,
				AztecAddress.fromString(token.address),
				recipientAddress,
				Number(amountInWei)
			);

			// Get frequency interval
			const frequencyOption = FREQUENCY_OPTIONS.find(
				(f) => f.value === frequency
			);
			if (!frequencyOption) {
				throw new Error("Invalid frequency selected");
			}

			// Calculate schedule
			const now = new Date();
			const startTime = new Date(now.getTime() + 10000); // Start in 10 seconds
			const endTime = new Date(
				startTime.getTime() +
					frequencyOption.intervalMs * (parseInt(numberOfPayments) - 1)
			);

			// Create job request
			const job: AutomatorJob = {
				id: "",
				txRequestStr: txRequest.toString(),
				account: {
					address: account.getAddress().toString(),
					secretKey: accountInfo!.secretKey,
					signingKey: accountInfo!.signingKey,
				},
				contractAddresses: [token.address],
				schedule: {
					start: startTime,
					end: endTime,
					interval: frequencyOption.intervalMs,
				},
				status: "pending",
			};

			// Send job request
			const automatorClient = new AutomatorClient(AUTOMATOR_URL);
			const result = await automatorClient.sendJobRequest(job);

			setSuccess(
				`Recurring payment scheduled successfully! Job ID: ${result.jobId}. ${result.scheduledExecutions} payments scheduled.`
			);

			// Clear form
			setRecipient("");
			setAmount("");
			setFrequency("20s");
			setNumberOfPayments("5");

			// Refresh payment jobs
			fetchPaymentJobs();
		} catch (e) {
			setError("Failed to create recurring payment: " + e);
		} finally {
			setLoading(false);
		}
	};

	const handleCancelJob = async (jobId: string) => {
		try {
			const response = await fetch(`${AUTOMATOR_URL}/jobs/${jobId}`, {
				method: "DELETE",
			});

			if (response.ok) {
				setSuccess("Payment job cancelled successfully!");
				fetchPaymentJobs();
			} else {
				setError("Failed to cancel payment job");
			}
		} catch (e) {
			setError("Failed to cancel payment job: " + e);
		}
	};

	const formatDate = (dateString: string) => {
		return new Date(dateString).toLocaleString();
	};

	const getStatusColor = (status: string) => {
		return status === "scheduled" ? "blue" : "green";
	};

	return (
		<Stack
			align="center"
			justify="space-between"
			gap="md"
			style={{ maxWidth: "1000px", margin: "0 auto", padding: "24px" }}
		>
			{/* Header Section */}
			<div
				style={{
					textAlign: "center",
					marginBottom: "12px",
					borderBottom: "1px solid #eaeef3",
					paddingBottom: "20px",
					width: "100%",
				}}
			>
				<Text size="30px" style={{ fontWeight: 500, marginBottom: "16px" }}>
					Recurring Payment App on Aztec
				</Text>
				<Text size="16px" color="dimmed" style={{ marginBottom: "16px" }}>
					schedule private recurring payments on TEE
				</Text>

				{/* Configuration Information */}
				<div
					style={{
						display: "flex",
						justifyContent: "center",
						gap: "24px",
						marginTop: "16px",
						fontSize: "12px",
						color: "#868e96",
					}}
				></div>
			</div>

			{/* Error and Success Messages */}
			{error && (
				<Alert color="red" title="Error" onClose={() => setError(null)}>
					{error}
				</Alert>
			)}

			{success && (
				<Alert color="green" title="Success" onClose={() => setSuccess(null)}>
					{success}
				</Alert>
			)}

			{/* Account Display */}
			{account ? (
				<div style={{ width: "100%" }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							backgroundColor: "#f8f9fa",
							padding: "10px 16px",
							borderRadius: "8px",
							width: "40%",
							margin: "0 auto",
							marginBottom: "32px",
						}}
					>
						<Text size="md" w={500}>
							Account:
						</Text>
						<Text size="md" color="dimmed" mx={8}>
							{shortenAddress(account.getAddress().toString())}
						</Text>
					</div>

					{tokenContract && token ? (
						<>
							{/* Token Info Card */}
							<Card
								shadow="sm"
								padding="md"
								radius="md"
								withBorder
								style={{ marginBottom: "24px" }}
							>
								<Group justify="space-between" mb="xs">
									<Group>
										<Text size="lg" fw={600}>
											{token.name}
										</Text>
										<Badge color="blue" size="sm">
											{token.symbol}
										</Badge>
										<CopyButton value={token.address}>
											{({ copied, copy }) => (
												<Tooltip label={copied ? "Copied" : "Copy"}>
													<ActionIcon onClick={copy}>
														{" "}
														<CheckIcon size={8} />
													</ActionIcon>
												</Tooltip>
											)}
										</CopyButton>
									</Group>

									<Button
										size="xs"
										variant="light"
										disabled={loadingBalances}
										onClick={fetchBalances}
									>
										{loadingBalances ? <Loader size="xs" /> : "Refresh"}
									</Button>
								</Group>

								<Text size="sm" color="dimmed" mb="xs">
									Private Balance: {privateBalance || "0"} {token.symbol}
								</Text>
							</Card>

							{/* Create Recurring Payment Section */}
							<Card
								shadow="sm"
								padding="lg"
								radius="md"
								withBorder
								style={{ marginBottom: "24px" }}
							>
								<Text size="lg" fw={600} mb="md">
									Create Recurring Payment
								</Text>

								<Stack gap="md">
									<TextInput
										label="Recipient Address"
										placeholder="0x..."
										value={recipient}
										onChange={(e) => setRecipient(e.target.value)}
										required
									/>

									<TextInput
										label="Amount (per payment)"
										placeholder="Enter amount to send"
										value={amount}
										onChange={(e) => setAmount(e.target.value)}
										required
									/>

									<Select
										label="Frequency"
										placeholder="Select frequency"
										data={FREQUENCY_OPTIONS.map((f) => ({
											value: f.value,
											label: f.label,
										}))}
										value={frequency}
										onChange={(value) => setFrequency(value || "20s")}
										required
									/>

									<TextInput
										label="Number of Payments"
										placeholder="Enter number of payments"
										value={numberOfPayments}
										onChange={(e) => setNumberOfPayments(e.target.value)}
										type="number"
										min="1"
										max="100"
										required
									/>

									{/* Total Amount and Completion Date Display */}
									{amount && numberOfPayments && (
										<Card withBorder p="md" bg="gray.0">
											<Group justify="space-between">
												<Text size="sm" fw={500}>
													Total Transfer Amount:
												</Text>
												<Text size="sm" fw={600}>
													{totalAmount.toFixed(2)} {token.symbol}
												</Text>
											</Group>
											{lastPaymentDate && (
												<Text size="xs" color="dimmed" mt={4}>
													Last payment: {lastPaymentDate.toLocaleDateString()}{" "}
													at {lastPaymentDate.toLocaleTimeString()}
												</Text>
											)}
											{amountExceedsBalance && (
												<Text size="xs" color="red" mt={4}>
													⚠️ Insufficient balance for total transfer amount
												</Text>
											)}
										</Card>
									)}

									<Button
										onClick={handleCreateRecurringPayment}
										disabled={loading || amountExceedsBalance}
										loading={loading}
										fullWidth
									>
										Schedule Recurring Payment
									</Button>
								</Stack>
							</Card>

							{/* Payment History Section */}
							<Card shadow="sm" padding="lg" radius="md" withBorder>
								<Group justify="space-between" mb="md">
									<Text size="lg" fw={600}>
										Payment History
									</Text>
									<Group>
										<Button
											size="sm"
											variant="light"
											disabled={loadingJobs}
											onClick={fetchPaymentJobs}
										>
											{loadingJobs ? <Loader size="xs" /> : "Refresh"}
										</Button>
										<Button
											size="sm"
											variant="light"
											color="red"
											onClick={() => {
												clearCompletedJobs();
												fetchPaymentJobs();
											}}
										>
											Clear Completed
										</Button>
										<Button
											size="sm"
											variant="light"
											color="gray"
											onClick={debugLocalStorage}
										>
											Debug Storage
										</Button>
										<Button
											size="sm"
											variant="light"
											color="orange"
											onClick={testAddCompletedJob}
										>
											Test Add Job
										</Button>
									</Group>
								</Group>

								{paymentJobs.length === 0 ? (
									<Text color="dimmed" ta="center" py="xl">
										No payment jobs found
									</Text>
								) : (
									<Stack gap="sm">
										{paymentJobs.map((job) => (
											<Card key={job.executionId} withBorder p="md">
												<Group justify="space-between">
													<div>
														<Text size="sm" fw={500}>
															Job ID: {job.id}
														</Text>
														<Text size="xs" color="dimmed">
															Execution {job.executionIndex + 1}
														</Text>
														<Text size="xs" color="dimmed">
															{job.status === "completed"
																? `Completed: ${formatDate(
																		job.nextExecutionTime
																  )}`
																: `Next: ${formatDate(job.nextExecutionTime)}`}
														</Text>
													</div>
													<Group>
														<Badge color={getStatusColor(job.status)}>
															{job.status === "scheduled"
																? "Scheduled"
																: "Completed"}
														</Badge>
													</Group>
												</Group>
											</Card>
										))}
									</Stack>
								)}
							</Card>
						</>
					) : (
						<Card
							shadow="sm"
							padding="lg"
							radius="md"
							withBorder
							style={{ textAlign: "center" }}
						>
							<Text size="lg" mb="md">
								Initializing...
							</Text>
							<Loader />
						</Card>
					)}
				</div>
			) : (
				<Card padding="lg" style={{ textAlign: "center", width: "50%" }}>
					<Text size="lg" mb="md">
						Initializing account...
					</Text>
					<Loader style={{ margin: "0 auto", display: "block" }} />
				</Card>
			)}
		</Stack>
	);
}

export function shortenAddress(address: string) {
	return (
		address.substring(0, 10) + "..." + address.substring(address.length - 10)
	);
}
