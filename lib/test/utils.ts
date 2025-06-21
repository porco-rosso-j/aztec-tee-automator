import { SchnorrAccountContract } from "@aztec/accounts/schnorr";
import {
	AccountManager,
	AccountWalletWithSecretKey,
	deriveMasterIncomingViewingSecretKey,
	FeeJuicePaymentMethod,
	type PXE,
} from "@aztec/aztec.js";

export const createAccount = async (
	pxe: PXE,
	deployer: AccountWalletWithSecretKey,
	salt: number
) => {
	console.log("Creating account");
	// Generate a new secret key for each wallet
	const encryptionPrivateKey = deriveMasterIncomingViewingSecretKey(
		deployer.getSecretKey()
	);
	const accountContract = new SchnorrAccountContract(encryptionPrivateKey);

	console.log("Creating account manager");
	// Create a new AccountManager instance
	const accountManager = await AccountManager.create(
		pxe,
		deployer.getSecretKey(),
		accountContract,
		salt
	);

	console.log("Registering account");
	// Register the account and get the wallet
	const wallet = await accountManager.register(); // Returns AccountWalletWithSecretKey

	const paymentMethod = new FeeJuicePaymentMethod(deployer.getAddress());

	console.log("Deploying account");
	await accountManager
		.deploy({
			skipPublicDeployment: false,
			skipClassRegistration: false,
			fee: { paymentMethod },
		})
		.wait();

	console.log("registered account");
	return wallet;
};
