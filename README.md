# Aztec TEE Automator

deck: https://docs.google.com/presentation/d/1q-xdqGwrcpZFMMz6ZRRnUJLQHrlVytR_m43hLyWhcuA/edit?usp=sharing
demo: https://youtu.be/iw3Ut8DCJkg

## Overview 
Smart contract automation is a widely-adopted solution in crypto applications and protocols, e.g. Gelato and Chainlink. Primary use cases in finance(DeFi) are limit order, DCA, auto-rebalancing, and recurring payment, but you can also find non-financial ones, e.g.  time-locked proposal execution in DAO and auto-token ( airdrop / NFT ) claiming.  

However, it is currently difficult to implement it on Aztec, a privacy-first Ethereum layer2 zkrollup, without compromising privacy. This is because whoever initiates transactions have to know complete information about the transaction for proving. In other words, the third party you outsource your work(transactions) to can know what you do, e.g. what / how much token you transfer to whom. 

This is where Aztec TEE Automator, Intel-TDX-based PXE server that privately executes scheduled txs on behalf of users, comes into play. We use Phala's TEE infrastructure called CVM(Confidential Virtual Machine) where our automator service is deployed as a docker image. Phala not only provides cloud dashboard useful for configuring/monitoring our service in TEE but also tools/infra for attestation over TEE and apps running inside.

To be more concrete on what our automator does, it basically 1) receives encrypted job requests from users that contain tx execution requests along with the information about user's account keys, contracts, execution schedule, 2) decrypts them and registers accounts & contracts into PXE running in the server, 3) periodically check and execute the job. 

For this hackathon, we built the TEE Automator server service, client-side library for any apps to tap into this service, and a demo example app of recurring payments that demonstrates the utility of the service and library. 


## Develop

*run aztec sandbox with version 0.87.8

run frontend
```shell
cd app
pnpm dev
```

run test
```shell
cd lib
pnpm test test/sandbox.test.ts
```
