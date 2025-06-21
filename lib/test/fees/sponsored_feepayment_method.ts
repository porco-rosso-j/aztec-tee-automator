import type { FeePaymentMethod } from "@aztec/aztec.js"
import { FunctionSelector, FunctionType } from "@aztec/stdlib/abi"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { PXE } from "@aztec/stdlib/interfaces/client"

import { getDeployedSponsoredFPCAddress } from "./sponsored_fpc.js"
import { ExecutionPayload } from "@aztec/entrypoints/payload"

/**
 * A payment method that uses the SponsoredFPCContract to pay the fee unconditionally.
 */
export class SponsoredFeePaymentMethod implements FeePaymentMethod {
  constructor(private paymentContract: AztecAddress) {}

  getAsset(): Promise<AztecAddress> {
    throw new Error("Asset is not required for sponsored fpc.")
  }

  getFeePayer() {
    return Promise.resolve(this.paymentContract)
  }

  async getExecutionPayload(): Promise<ExecutionPayload> {
    return new ExecutionPayload(
      [
        {
          name: "sponsor_unconditionally",
          to: this.paymentContract,
          selector: await FunctionSelector.fromSignature("sponsor_unconditionally()"),
          type: FunctionType.PRIVATE,
          isStatic: false,
          args: [],
          returnTypes: [],
        },
      ],
      [],
      [],
    )
  }
}

export async function getSponsoredFeePaymentMethod(pxe: PXE) {
  const paymentContract = await getDeployedSponsoredFPCAddress(pxe)
  return new SponsoredFeePaymentMethod(paymentContract)
}
