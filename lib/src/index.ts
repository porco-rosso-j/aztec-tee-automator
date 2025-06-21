import ky from "ky";
import ms from "ms";
import { joinURL } from "ufo";
import { z } from "zod";
import { encrypt } from "./encrypt.js";

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

export class AutomatorClient {
	// TODO: move switching proving modes to a different class

	constructor(private apiUrl: string) {}

	async sendJobRequest(jobRequest: AutomatorJob): Promise<any> {
		console.log("sendJobRequest: ", this.apiUrl);
		const encryptionPublicKey = await this.fetchEncryptionPublicKey();

		// Convert JSON string to bytes using TextEncoder (browser-compatible)
		const jsonString = JSON.stringify(jobRequest);
		const textEncoder = new TextEncoder();
		const jsonBytes = textEncoder.encode(jsonString);

		const encryptedData = await encrypt({
			data: jsonBytes,
			encryptionPublicKey,
		});

		// Convert bytes to Base64 using btoa (browser-compatible)
		const base64Data = btoa(
			String.fromCharCode(...new Uint8Array(encryptedData))
		);

		const response = await ky
			.post(joinURL(this.apiUrl, "jobs"), {
				json: { data: base64Data },
				timeout: ms("1 min"),
			})
			.json();

		console.log("response", response);
		return response;
	}

	// todo
	// - get job
	// - cancel job

	private async fetchEncryptionPublicKey() {
		// TODO(security): verify the integrity of the encryption public key
		const response = await ky
			.get(joinURL(this.apiUrl, "encryption-public-key"))
			.json();
		const data = z
			.object({
				publicKey: z.string(),
			})
			.parse(response);
		return data.publicKey;
	}
}
