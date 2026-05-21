import * as anchor from "@coral-xyz/anchor";
import { Opal } from "../target/types/opal";
import * as fs from "fs";

const CONFIG = {
  rpcEndpoint: process.env.RPC_ENDPOINT || "https://api.devnet.solana.com",
  walletPath: process.env.WALLET_PATH || "~/.config/solana/id.json",
  programId: process.env.PROGRAM_ID || "8NCcxyAzKiAHxJ9DMnADtxShYutS9w81wHcXqgCavTBy",
  resolverEndpoint: process.env.RESOLVER_ENDPOINT || "http://localhost:3000",
  assertionId: process.env.ASSERTION_ID || "",
  pollInterval: 5000,
  maxWaitTime: 300000,
};

function loadWallet(path: string): anchor.web3.Keypair {
  const resolvedPath = path.replace("~", process.env.HOME || "");
  const secretKey = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function kickOffResolver(
  assertionId: string
): Promise<{ requestId: string; estimatedTime: number }> {
  console.log("\n[Phase 1] Kicking off resolver...");

  const response = await fetch(`${CONFIG.resolverEndpoint}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assertionId }),
  });

  if (!response.ok) {
    throw new Error(`Resolver error: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`✓ Resolver started`);
  console.log(`  Request ID: ${data.requestId}`);
  console.log(`  Estimated time: ${data.estimatedTime}s`);

  return data;
}

async function pollForResult(
  requestId: string,
  maxWaitMs: number = CONFIG.maxWaitTime
): Promise<{
  verdict: number;
  promptHash: string;
  variableOverridesHash: string;
  responseHash: string;
  evidenceHash: string;
}> {
  console.log("\n[Phase 2] Polling for resolver result...");

  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(`${CONFIG.resolverEndpoint}/result/${requestId}`);

      if (response.ok) {
        const result = await response.json();
        console.log(`✓ Result received`);
        console.log(`  Verdict: ${result.verdict}`);
        console.log(`  Prompt Hash: ${result.promptHash.slice(0, 16)}...`);
        return result;
      }

      if (response.status === 404) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.log(`  Still waiting... (${elapsed}s)`);
        await new Promise((resolve) => setTimeout(resolve, CONFIG.pollInterval));
        continue;
      }

      throw new Error(`Poll error: ${response.statusText}`);
    } catch (error) {
      console.error(`Poll attempt failed:`, error);
      await new Promise((resolve) => setTimeout(resolve, CONFIG.pollInterval));
    }
  }

  throw new Error(`Result not received within ${maxWaitMs / 1000}s timeout`);
}

async function submitVerdictOnChain(
  program: anchor.Program<Opal>,
  wallet: anchor.web3.Keypair,
  programId: anchor.web3.PublicKey,
  assertionId: string,
  result: {
    verdict: number;
    promptHash: string;
    variableOverridesHash: string;
    responseHash: string;
    evidenceHash: string;
  }
) {
  console.log("\n[Phase 3] Submitting verdict on-chain...");

  // Derive PDAs
  const [assertion] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("assertion"), new anchor.web3.PublicKey(assertionId).toBuffer()],
    programId
  );

  const [protocolConfig] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    programId
  );

  const [llmResolutionRound] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("llm_round"), assertion.toBuffer()],
    programId
  );

  // Create a mock oracle quote account for now
  // In production, this would be the actual quote from Switchboard relayer
  const quoteKeypair = anchor.web3.Keypair.generate();

  try {
    const tx = await program.methods
      .submitLlmResolution()
      .accounts({
        payer: wallet.publicKey,
        protocolConfig,
        assertion,
        llmResolutionRound,
        oracleQuote: quoteKeypair.publicKey,
      })
      .rpc();

    console.log(`✓ Verdict submitted on-chain`);
    console.log(`  Transaction: ${tx}`);
  } catch (error) {
    console.error("\n✗ Failed to submit verdict:");
    console.error(error);
    throw error;
  }
}

async function main() {
  if (!CONFIG.assertionId) {
    console.error("Error: ASSERTION_ID environment variable is required");
    console.error("Usage: ASSERTION_ID=<id> npx ts-node relayer.ts");
    process.exit(1);
  }

  const wallet = loadWallet(CONFIG.walletPath);
  const connection = new anchor.web3.Connection(CONFIG.rpcEndpoint, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {});

  const programId = new anchor.web3.PublicKey(CONFIG.programId);
  const program = new anchor.Program<Opal>(
    require("../target/idl/opal.json"),
    programId,
    provider
  );

  console.log("=".repeat(60));
  console.log("Oracle Resolver Relayer");
  console.log("=".repeat(60));

  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("Program:", programId.toBase58());
  console.log("Assertion ID:", CONFIG.assertionId);
  console.log("Resolver:", CONFIG.resolverEndpoint);

  try {
    const phaseOne = await kickOffResolver(CONFIG.assertionId);
    const result = await pollForResult(phaseOne.requestId);
    await submitVerdictOnChain(program, wallet, programId, CONFIG.assertionId, result);

    console.log("\n" + "=".repeat(60));
    console.log("✓ Resolution complete");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n" + "=".repeat(60));
    console.error("✗ Relayer failed:");
    console.error(error);
    console.error("=".repeat(60));
    process.exit(1);
  }
}

main();
