import {
	AztecAddress,
	createAztecNodeClient,
	loadContractArtifact,
	type NoirCompiledContract,
} from "@aztec/aztec.js";
import { computeArtifactHash } from "@aztec/stdlib/contract";
import { describe, it } from "vitest";
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";

// pnpm test scripts/uploadArtifacts.test.ts

export async function uploadArtifacts() {
	const artifactRegistryURL = "https://registry.obsidion.xyz/artifacts";
	const contracts = [
		{
			address: AztecAddress.ZERO,
			artifact: SponsoredFPCContractArtifact,
			name: "sponsoredFPC",
		},
		{
			address: AztecAddress.ZERO,
			artifact: TokenContractArtifact,
			name: "token",
		},
	];
	for (const contract of contracts) {
		const compiledArtifact = loadContractArtifact(
			contract.artifact as unknown as NoirCompiledContract
		);
		console.log(
			"artifact hash: ",
			(await computeArtifactHash(compiledArtifact)).toString()
		);

		const response = await request({
			method: "POST",
			url: artifactRegistryURL,
			body: compiledArtifact,
		});
		console.log("response: ", response);
	}
}

async function request({
	url,
	method,
	body,
}: {
	url: string;
	method: string;
	body?: unknown;
}) {
	const response = await fetch(url, {
		method,
		body: body ? JSON.stringify(body) : undefined,
		headers: {
			"Content-Type": "application/json",
		},
	});
	if (!response.ok) {
		throw new Error(
			`Failed to fetch ${url}: ${response.status} ${
				response.statusText
			} | ${await response.text()}`
		);
	}
	return await response.json();
}

describe(
	"Script",
	async () => {
		it("script", async () => {
			await uploadArtifacts();
		}, 1000000);
	},
	{ timeout: 1000000 }
);
