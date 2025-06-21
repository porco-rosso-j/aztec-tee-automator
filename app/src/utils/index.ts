import { type PXE } from "@aztec/aztec.js";
import { GasSettings } from "@aztec/stdlib/gas";
import { getSponsoredFeePaymentMethod } from "./sponsored_feepayment_method";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { AztecAddress } from "@aztec/aztec.js";
import { AccountWallet } from "@aztec/aztec.js";
import { getSponsoredFPCInstance } from "./sponsored_fpc";
import {
	SponsoredFPCContract,
	SponsoredFPCContractArtifact,
} from "@aztec/noir-contracts.js/SponsoredFPC";

export const getFee = async (pxe: PXE) => {
	const sponsoredFPC = await getSponsoredFPCInstance();
	await pxe.registerContract({
		instance: sponsoredFPC,
		artifact: SponsoredFPCContract.artifact,
	});
	return {
		paymentMethod: await getSponsoredFeePaymentMethod(pxe),
		gasSettings: GasSettings.default({
			maxFeesPerGas: await pxe.getCurrentBaseFees(),
		}),
	};
};

export const getTokenTransferTxRequest = async (
	pxe: PXE,
	account: AccountWallet,
	tokenAddress: AztecAddress,
	recipient: AztecAddress,
	amount: number
) => {
	const tokenContract = await TokenContract.at(tokenAddress, account);
	const request = await tokenContract.methods
		.transfer_in_private(account.getAddress(), recipient, amount, 0)
		.create({
			fee: await getFee(pxe),
		});

	return request;
};
