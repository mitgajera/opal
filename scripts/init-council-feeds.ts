import {
  CrossbarClient,
  PullFeed,
  SwitchboardProgram,
} from "@switchboard-xyz/on-demand";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import os from "os";
import path from "path";
import { COUNCIL_JOB_NAMES, COUNCIL_JOBS } from "./jobs.js";

const DEVNET_RPC = "https://api.devnet.solana.com";
const DEVNET_QUEUE = new PublicKey("FfD96yeXs4cxZshoPPSKhSPgVQxLAJUT3gefgh84m1Di");
const MAX_VARIANCE = 0;
const MIN_RESPONSES = 3;
const MAX_STALENESS_SLOTS = 250;

function loadKeypair(): Keypair {
  const keypairPath =
    process.env.SOLANA_KEYPAIR ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf-8")))
  );
}

async function main() {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const payer = loadKeypair();
  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
  });

  console.log("Payer:", payer.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(payer.publicKey)) / 1e9, "SOL");

  const sbProgram = await SwitchboardProgram.load("devnet", provider as any);
  const crossbar = CrossbarClient.default();
  const feedPubkeys: string[] = [];

  for (let i = 0; i < COUNCIL_JOBS.length; i++) {
    const job = COUNCIL_JOBS[i];
    const name = COUNCIL_JOB_NAMES[i];

    console.log(`\n── Creating feed ${i}: ${name} ──`);

    console.log("  Storing job on Crossbar…");
    const { feedHash } = await crossbar.store(DEVNET_QUEUE, [job]);
    console.log("  Feed hash:", feedHash);

    console.log("  Initialising PullFeed account…");
    const [pullFeed, initTx] = await PullFeed.initTx(sbProgram, {
      queue: DEVNET_QUEUE,
      maxVariance: MAX_VARIANCE,
      minResponses: MIN_RESPONSES,
      feedHash: Buffer.from(feedHash, "hex"),
      payer: payer.publicKey,
      minSampleSize: MIN_RESPONSES,
      maxStalenessSlots: MAX_STALENESS_SLOTS,
      name,
    });

    const sig = await sendAndConfirmTransaction(connection, initTx, [payer], {
      commitment: "confirmed",
    });
    console.log("  Tx:", sig);
    console.log("  Feed pubkey:", pullFeed.pubkey.toBase58());

    feedPubkeys.push(pullFeed.pubkey.toBase58());
  }

  console.log("\n══════════════════════════════════════════════════════");
  console.log("Council feed pubkeys (copy these into set_council_feeds):");
  feedPubkeys.forEach((pk, i) => {
    console.log(`  [${i}] ${COUNCIL_JOB_NAMES[i]}`);
    console.log(`      ${pk}`);
  });
  console.log("══════════════════════════════════════════════════════");
  console.log("\nNext: call set_council_feeds on your ProtocolConfig with these pubkeys.");
  console.log(
    `  anchor run set-feeds -- ${feedPubkeys.map((p) => `--feed ${p}`).join(" ")}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
