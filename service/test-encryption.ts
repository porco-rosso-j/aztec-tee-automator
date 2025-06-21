import { EncryptionService } from "./src/EncryptionService.js";
import { Base64, Bytes } from "ox";
import { encrypt } from "../lib/src/encrypt.js";

// node --loader ts-node/esm --experimental-specifier-resolution=node --no-warnings test-encryption.ts
async function testEncryptionDecryption() {
	console.log("🧪 Testing encryption/decryption flow...");

	// Initialize encryption service (simulates server)
	const encryptionService = new EncryptionService();

	// Get the public key (simulates client fetching from server)
	const publicKey = await encryptionService.getEncryptionPublicKey();
	console.log("✅ Public key retrieved:", publicKey.substring(0, 50) + "...");

	// Simulate the data that would be sent by AutomatorClient
	const testJobData = {
		txRequestStr: "test-tx-request",
		account: {
			address: "0x1234567890abcdef",
			secretKey: "secret-key-123",
			signingKey: "signing-key-456",
		},
		contractAddresses: ["0xabcdef1234567890"],
		schedule: {
			start: "2024-01-01T00:00:00Z",
			end: "2024-01-02T00:00:00Z",
			interval: 3600000, // 1 hour in milliseconds
		},
	};

	console.log("📤 Original job data:", testJobData);

	try {
		// Simulate client-side encryption (this is what AutomatorClient does)
		const jsonString = JSON.stringify(testJobData);
		const jsonBytes = Bytes.fromString(jsonString);

		console.log("📦 JSON bytes length:", jsonBytes.length);

		// Encrypt the data using the public key (client-side)
		const encryptedBytes = await encrypt({
			data: jsonBytes,
			encryptionPublicKey: publicKey,
		});

		console.log("🔐 Encrypted bytes length:", encryptedBytes.length);

		// Convert to Base64 (this is what AutomatorClient sends)
		const base64Data = Base64.fromBytes(encryptedBytes);
		console.log(
			"🔐 Base64 encoded encrypted data:",
			base64Data.substring(0, 50) + "..."
		);

		// Simulate server-side decryption (this is what the server does)
		const decryptedBytes = await encryptionService.decrypt({
			data: Base64.toBytes(base64Data),
		});

		const decryptedJson = JSON.parse(Bytes.toString(decryptedBytes));
		console.log("📥 Decrypted job data:", decryptedJson);

		// Verify the data matches
		const isMatch =
			JSON.stringify(testJobData) === JSON.stringify(decryptedJson);
		console.log("✅ Data integrity check:", isMatch ? "PASSED" : "FAILED");

		if (isMatch) {
			console.log("🎉 Encryption/decryption flow test PASSED!");
		} else {
			console.log("❌ Encryption/decryption flow test FAILED!");
		}
	} catch (error) {
		console.error("❌ Test failed:", error);
	}
}

// Run the test
testEncryptionDecryption().catch(console.error);
