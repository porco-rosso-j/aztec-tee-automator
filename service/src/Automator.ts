import {
	getSchnorrWallet,
	SchnorrAccountContractArtifact,
} from "@aztec/accounts/schnorr";
import {
	AztecAddress,
	createAztecNodeClient,
	Fq,
	Fr,
	TxExecutionRequest,
	waitForPXE,
	type AztecNode,
	type ContractArtifact,
	type PXE,
} from "@aztec/aztec.js";
import { computePartialAddress } from "@aztec/stdlib/contract";
import { fetchArtifact } from "./utils.js";
import { getPXEServiceConfig } from "@aztec/pxe/config";
import { createPXEService } from "@aztec/pxe/server";
import { createStore } from "@aztec/kv-store/lmdb";

export type Account = {
	address: string;
	secretKey: string;
	signingKey: string;
};

export type AutomatorJob = {
	id: string;
	txRequestStr: string;
	account: Account;
	contractAddresses: string[];
	schedule: {
		start: Date;
		end: Date;
		interval: number;
	};
	status: "pending" | "completed" | "failed" | "cancelled";
};

class AutomatorStorage {
	private jobs: Map<string, AutomatorJob> = new Map();

	constructor() {
		this.jobs = new Map();
	}

	addJob(job: AutomatorJob) {
		this.jobs.set(job.id, job);
	}

	removeJob(id: string) {
		this.jobs.delete(id);
	}

	getJob(id: string) {
		return this.jobs.get(id);
	}

	getAllJobs(): AutomatorJob[] {
		return Array.from(this.jobs.values());
	}
}

export class Automator {
	private storage: AutomatorStorage;
	private pxe: PXE | null = null;
	private node: AztecNode | null = null;
	private artifactServerURL: string;
	private isExecuting = false;

	constructor(artifactServerURL: string) {
		this.storage = new AutomatorStorage();
		this.artifactServerURL = artifactServerURL;
	}

	async init(nodeURL: string) {
		console.log("Initializing Automator");
		const { pxe, node } = await createPXEAndNode(nodeURL);
		this.pxe = pxe;
		this.node = node;
	}

	// register job, account, and contracts
	async registerJob(job: AutomatorJob) {
		console.log("Registering job", job);
		try {
			await this.registerAccount(job.account);

			for (const contractAddress of job.contractAddresses) {
				await this.registerContract(contractAddress);
			}

			this.storage.addJob(job);
		} catch (error) {
			console.error(error);
			throw error;
		}
	}

	async execute(id: string) {
		if (this.isExecuting) {
			// todo: put it into a queue. for now just ignore.
			return;
		}

		this.isExecuting = true;

		if (!this.pxe || !this.node) {
			throw new Error("PXE and node not initialized");
		}

		console.log("Executing job", id);
		const job = this.storage.getJob(id);
		if (!job) {
			throw new Error(`Job ${id} not found`);
		}

		if (job.status !== "pending") {
			throw new Error(`Job ${id}'s status is not pending but ${job.status}`);
		}

		try {
			const txRequest = TxExecutionRequest.fromString(job.txRequestStr);
			txRequest.salt = Fr.random(); // to make each tx request unique

			console.log("Simulating tx request", txRequest);
			// only supports schnorr accounts for now
			const account = await getSchnorrWallet(
				this.pxe,
				AztecAddress.fromString(job.account.address),
				Fq.fromString(job.account.signingKey)
			);
			console.log("Account recovered", account.getAddress().toString());

			console.log("Simulating tx request");
			const simulationResult = await account.simulateTx(txRequest, true);

			console.log("Proving tx request");
			const provenTx = await account.proveTx(
				txRequest,
				simulationResult.privateExecutionResult
			);

			console.log("Sending tx");
			const txHash = await account.sendTx(provenTx.toTx());
			console.log("Tx sent", txHash.toString());

			return txHash;
		} catch (error) {
			console.error(error);
			throw error;
		} finally {
			this.isExecuting = false;
		}
	}

	private async registerAccount(account: Account) {
		if (!this.pxe || !this.node) {
			throw new Error("PXE and node not initialized");
		}

		console.log("Registering account", account);
		try {
			// check if account is already registered
			const accountContractMetadata = await this.pxe.getContractMetadata(
				AztecAddress.fromString(account.address)
			);

			const registeredAccounts = await this.pxe.getRegisteredAccounts();

			if (
				accountContractMetadata.contractInstance &&
				registeredAccounts.find(
					(acc) => acc.address.toString() === account.address
				)
			)
				return;

			console.log("Account hasn't been registered yet, registering it");
			// if account is not registered yet, register it

			const accountContractInstance = await this.node.getContract(
				AztecAddress.fromString(account.address)
			);

			if (!accountContractInstance)
				throw new Error(`Account contract not found in node`);

			await this.pxe.registerContract({
				instance: accountContractInstance,
				artifact: SchnorrAccountContractArtifact,
			});

			const partialAddress = await computePartialAddress(
				accountContractInstance
			);

			await this.pxe.registerAccount(
				Fr.fromString(account.secretKey),
				partialAddress
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	}

	private async registerContract(address: string) {
		if (!this.pxe || !this.node) {
			throw new Error("PXE and node not initialized");
		}

		console.log("Registering contract", address);
		try {
			const contractMetadata = await this.pxe.getContractMetadata(
				AztecAddress.fromString(address)
			);

			if (contractMetadata && contractMetadata.contractInstance) {
				console.log(`Contract ${address} already registered`);
				return;
			}

			const contractInstance = await this.node.getContract(
				AztecAddress.fromString(address)
			);

			if (!contractInstance) throw new Error(`Contract not found in node`);

			const contractClassMetadata = await this.pxe.getContractClassMetadata(
				contractInstance.currentContractClassId,
				true
			);

			let artifact: ContractArtifact;

			if (!contractClassMetadata.artifact) {
				const contractClass = await this.node.getContractClass(
					contractInstance.currentContractClassId
				);

				if (!contractClass) {
					throw new Error(`Contract class not found`);
				}

				// register contract by fetching artifact from artifact server
				console.log("Fetching artifact from artifact server...");
				artifact = await fetchArtifact(
					this.artifactServerURL,
					contractClass?.artifactHash
				);
			} else {
				console.log("Using existing artifact in PXE");
				artifact = contractClassMetadata.artifact;
			}

			await this.pxe.registerContract({
				instance: contractInstance,
				artifact,
			});
		} catch (error) {
			console.error(error);
			throw error;
		}
	}

	getJob(id: string): AutomatorJob | undefined {
		return this.storage.getJob(id);
	}

	getAllJobs(): AutomatorJob[] {
		return this.storage.getAllJobs();
	}
}

const createPXEAndNode = async (nodeURL: string) => {
	console.log("Creating PXE and node");
	const node = createAztecNodeClient(nodeURL);
	const config = getPXEServiceConfig();
	config.proverEnabled = false;

	console.log("createPXEService...");
	const pxe = await createPXEService(node, config, {
		store: await createStore("pxe", {
			dataDirectory: "store",
			dataStoreMapSizeKB: 1e6,
		}),
	});
	console.log("waitForPXE...");
	await waitForPXE(pxe);
	console.log("PXE and node created");
	return { pxe, node };
};
