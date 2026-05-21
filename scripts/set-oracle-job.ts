import * as anchor from "@coral-xyz/anchor";
import { Opal } from "../target/types/opal";
import * as fs from "fs";

const CONFIG = {
  rpcEndpoint: process.env.RPC_ENDPOINT || "https://api.devnet.solana.com",
  walletPath: process.env.WALLET_PATH || "~/.config/solana/id.json",
  programId: process.env.PROGRAM_ID || "8NCcxyAzKiAHxJ9DMnADtxShYutS9w81wHcXqgCavTBy",
  oracleJobHash: process.env.ORACLE_JOB_HASH || "",
};

function loadWallet(path: string): anchor.web3.Keypair {
  const resolvedPath = path.replace("~", process.env.HOME || "");
  const secretKey = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function main() {
  if (!CONFIG.oracleJobHash) {
    console.error("Error: ORACLE_JOB_HASH environment variable is required");
    console.error("Usage: ORACLE_JOB_HASH=<64-char-hex> npx ts-node set-oracle-job.ts");
    process.exit(1);
  }

  // Validate hex format
  if (!/^[0-9a-fA-F]{64}$/.test(CONFIG.oracleJobHash.replace(/^0x/, ""))) {
    console.error("Error: ORACLE_JOB_HASH must be a 64-character hex string");
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
  console.log("Setting Oracle Job Hash");
  console.log("=".repeat(60));

  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("Program:", programId.toBase58());
  console.log("Oracle Job Hash:", CONFIG.oracleJobHash);

  const [protocolConfig] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    programId
  );

  console.log("Protocol Config:", protocolConfig.toBase58());

  // Convert hex string to [u8; 32]
  const hashHex = CONFIG.oracleJobHash.replace(/^0x/, "");
  const hashBuffer = Buffer.from(hashHex, "hex");
  const oracleJobHash = Array.from(hashBuffer) as number[];

  try {
    const tx = await program.methods
      .setOracleJob({
        oracleJobHash,
      })
      .accounts({
        authority: wallet.publicKey,
        protocolConfig,
      })
      .rpc();

    console.log("\n✓ Successfully set oracle job hash");
    console.log("Transaction:", tx);
  } catch (error) {
    console.error("\n✗ Failed to set oracle job hash:");
    console.error(error);
    process.exit(1);
  }
}

main();
