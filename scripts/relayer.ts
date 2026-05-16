import { PullFeed } from "@switchboard-xyz/on-demand";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import os from "os";
import path from "path";
import idl from "../target/idl/opal.json" assert { type: "json" };
import type { Opal } from "../target/types/opal";

const POLL_INTERVAL_MS = 10_000;
const COMPUTE_UNIT_LIMIT_MULTIPLIER = 1.3;
const COMPUTE_UNIT_PRICE_MICROLAMPORTS = 200_000;
const ASSERTION_STATE_PENDING_LLM = 1;

// 8 discriminator + 32 id + 32 asserter + 280 statement + 128 auxiliary_hash + 32 bond_vault
const STATE_FIELD_OFFSET = 8 + 32 + 32 + 280 + 128 + 32;

const SEEDS = {
  PROTOCOL_CONFIG: Buffer.from("protocol_config"),
  LLM_ROUND: Buffer.from("llm_round"),
};

function loadKeypair(): Keypair {
  const p =
    process.env.SOLANA_KEYPAIR ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8")))
  );
}

function buildProvider(connection: Connection, payer: Keypair): AnchorProvider {
  return new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
  });
}

async function fetchPendingAssertions(
  connection: Connection,
  programId: PublicKey
): Promise<PublicKey[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      {
        memcmp: {
          offset: STATE_FIELD_OFFSET,
          bytes: Buffer.from([ASSERTION_STATE_PENDING_LLM]).toString("base64"),
          encoding: "base64",
        },
      },
    ],
  });
  return accounts.map((a) => a.pubkey);
}

// 8 discriminator + 32 assertion + 32 dispute = offset 72 into LlmResolutionRound
function parseCouncilFeeds(data: Buffer): [PublicKey, PublicKey, PublicKey] {
  const offset = 8 + 32 + 32;
  return [
    new PublicKey(data.subarray(offset, offset + 32)),
    new PublicKey(data.subarray(offset + 32, offset + 64)),
    new PublicKey(data.subarray(offset + 64, offset + 96)),
  ];
}

async function resolveAssertion(
  assertionPubkey: PublicKey,
  program: Program<Opal>,
  connection: Connection,
  payer: Keypair
): Promise<void> {
  const programId = program.programId;

  const [llmRoundPda] = PublicKey.findProgramAddressSync(
    [SEEDS.LLM_ROUND, assertionPubkey.toBuffer()],
    programId
  );
  const [configPda] = PublicKey.findProgramAddressSync(
    [SEEDS.PROTOCOL_CONFIG],
    programId
  );

  const roundInfo = await connection.getAccountInfo(llmRoundPda, "confirmed");
  if (!roundInfo) {
    console.warn(`  Round account not found for assertion ${assertionPubkey.toBase58()}`);
    return;
  }

  const [feed0Pk, feed1Pk, feed2Pk] = parseCouncilFeeds(Buffer.from(roundInfo.data));

  if (feed0Pk.equals(PublicKey.default)) {
    console.warn("  Council feeds are zeroed — set_council_feeds not called yet, skipping.");
    return;
  }

  console.log("  Feed 0:", feed0Pk.toBase58());
  console.log("  Feed 1:", feed1Pk.toBase58());
  console.log("  Feed 2:", feed2Pk.toBase58());

  const assertionData = await program.account.assertionAccount.fetch(
    assertionPubkey,
    "confirmed"
  );

  const statementBytes = Buffer.from(assertionData.statement as any);
  const nullIdx = statementBytes.indexOf(0);
  const statement = statementBytes
    .subarray(0, nullIdx === -1 ? undefined : nullIdx)
    .toString("utf-8");

  const auxBytes = Buffer.from(assertionData.auxiliaryHash as any);
  const auxNull = auxBytes.indexOf(0);
  const auxiliaryData = auxBytes
    .subarray(0, auxNull === -1 ? undefined : auxNull)
    .toString("utf-8");

  console.log("  Statement:", statement.slice(0, 80));

  const variableOverrides = {
    CLAIM_STATEMENT: statement,
    AUXILIARY_DATA: auxiliaryData,
  };

  const feedUpdateIxs = await Promise.all(
    [feed0Pk, feed1Pk, feed2Pk].map(async (feedPk) => {
      const feedInfo = await connection.getAccountInfo(feedPk, "confirmed");
      if (!feedInfo) throw new Error(`Feed account ${feedPk.toBase58()} not found`);
      const feed = new PullFeed(feedPk);
      const [updateIx] = await feed.fetchUpdateIx({ numSignatures: 3, variableOverrides });
      return updateIx;
    })
  );

  const submitIx = await program.methods
    .submitLlmResolution()
    .accounts({
      payer: payer.publicKey,
      protocolConfig: configPda,
      assertion: assertionPubkey,
      llmResolutionRound: llmRoundPda,
      feed0: feed0Pk,
      feed1: feed1Pk,
      feed2: feed2Pk,
    })
    .instruction();

  const allIxs = [...feedUpdateIxs, submitIx];
  const estimatedCU = Math.ceil(
    (await connection
      .simulateTransaction(
        new VersionedTransaction(
          new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
            instructions: allIxs,
          }).compileToV0Message()
        )
      )
      .then((r) => r.value.unitsConsumed ?? 400_000)) * COMPUTE_UNIT_LIMIT_MULTIPLIER
  );

  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: Math.min(estimatedCU, 1_400_000),
  });
  const cuPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: COMPUTE_UNIT_PRICE_MICROLAMPORTS,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [cuPriceIx, cuLimitIx, ...feedUpdateIxs, submitIx],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  console.log("  ✓ Resolved — tx:", sig);
}

async function runOnce(
  program: Program<Opal>,
  connection: Connection,
  payer: Keypair
): Promise<void> {
  const pending = await fetchPendingAssertions(connection, program.programId);
  console.log(`Found ${pending.length} PENDING_LLM assertion(s).`);

  for (const assertionPk of pending) {
    console.log(`\nProcessing: ${assertionPk.toBase58()}`);
    try {
      await resolveAssertion(assertionPk, program, connection, payer);
    } catch (err) {
      console.error("  Error:", (err as Error).message);
    }
  }
}

async function main() {
  const once = process.argv.includes("--once");
  const rpc = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";

  const connection = new Connection(rpc, "confirmed");
  const payer = loadKeypair();
  const provider = buildProvider(connection, payer);
  const program = new Program<Opal>(idl as any, provider);

  console.log("Opal relayer started.");
  console.log("Program:", program.programId.toBase58());
  console.log("Payer:  ", payer.publicKey.toBase58());
  console.log("RPC:    ", rpc);
  console.log("Mode:   ", once ? "single-shot" : `polling every ${POLL_INTERVAL_MS / 1000}s`);

  if (once) {
    await runOnce(program, connection, payer);
    return;
  }

  while (true) {
    try {
      await runOnce(program, connection, payer);
    } catch (err) {
      console.error("Poll error:", (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
