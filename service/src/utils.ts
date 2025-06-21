import type { Fr } from "@aztec/aztec.js";
import { ContractArtifactSchema } from "@aztec/stdlib/abi";

export const fetchArtifact = async (
	artifactServerURL: string,
	artifactHash: Fr
) => {
	const response = await fetch(`${artifactServerURL}/${artifactHash}`, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
		},
	});
	const data = await response.json();
	const artifact = ContractArtifactSchema.parse(
		JSON.parse(JSON.stringify(data))
	);
	// Keep successful artifacts in cache - don't remove them
	return artifact;
};
