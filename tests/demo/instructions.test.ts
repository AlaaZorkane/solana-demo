import {
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AIRDROP_KEY, DEMO_PROGRAM_ID, MAYBE_FEE } from "../utils";
import { DemoInstructionBuilder } from "../../lib/demo";
import fs from "fs/promises";
import _ from "lodash";
import { JarAccountState } from "../../generated/programs/demo/state";

describe("demo instructions", async () => {
  const connection = new Connection(clusterApiUrl("devnet"));
  const wallet = new Keypair();
  const programId = DEMO_PROGRAM_ID;

  // Everyone that has some SOL in their account
  // needs to give back to the system
  const giveback = [wallet];

  const demoBuilder = new DemoInstructionBuilder(connection, wallet, programId);

  console.log("Wallet PK:", wallet.publicKey.toBase58());
  console.log("Program ID:", programId.toBase58());

  // Airdrop
  beforeAll(async () => {
    try {
      console.log("Getting you some free SOL 😎...");

      const airdrop = await connection.requestAirdrop(
        wallet.publicKey,
        LAMPORTS_PER_SOL
      );

      const confirmedTX = await connection.confirmTransaction(airdrop);

      expect(confirmedTX?.value?.err).toBeNull();

      console.log("Airdrop confirmed 🚀:", airdrop);
    } catch (err) {
      console.error("Airdrop failed 💥:", err);
    }
  }, 100_000);

  it.concurrent.skip("tx with echo instruction", async () => {
    const msg = "Hello from Vitest 🚀";
    const echoInstruction = demoBuilder.echo(msg);

    const transaction = new Transaction();
    transaction.add(echoInstruction);

    const tx = await sendAndConfirmTransaction(connection, transaction, [
      wallet,
    ]);
    expect(tx).toBeDefined();

    console.log("[ECHO] TX:", tx);
  });

  it.concurrent.skip("tx with add instruction", async () => {
    const addInstruction = demoBuilder.add(13, 37);

    const transaction = new Transaction();
    transaction.add(addInstruction);

    const tx = await sendAndConfirmTransaction(connection, transaction, [
      wallet,
    ]);

    expect(tx).toBeDefined();

    console.log("[ADD] TX:", tx);
  });

  it.concurrent.skip("tx with transfer instruction", async () => {
    const to = new Keypair();
    giveback.push(to);

    const transferInstruction = demoBuilder.transfer(
      to.publicKey,
      LAMPORTS_PER_SOL / 2
    );

    const transaction = new Transaction();

    transaction.add(transferInstruction);

    const tx = await sendAndConfirmTransaction(connection, transaction, [
      wallet,
    ]);

    expect(tx).toBeDefined();

    console.log("[TRANSFER] TX:", tx);
  });

  it.concurrent("tx with donate instruction", async () => {
    const donateInstruction = await demoBuilder.donate(LAMPORTS_PER_SOL / 4);

    const transaction = new Transaction();

    transaction.add(donateInstruction);

    const tx = await sendAndConfirmTransaction(connection, transaction, [
      wallet,
    ]);

    expect(tx).toBeDefined();

    console.log("[DONATE] TX:", tx);
  });

  it("tx with another donation from same owner", async () => {
    const donateInstruction = await demoBuilder.donate(LAMPORTS_PER_SOL / 4);

    const transaction = new Transaction();

    transaction.add(donateInstruction);

    const tx = await sendAndConfirmTransaction(connection, transaction, [
      wallet,
    ]);

    expect(tx).toBeDefined();

    console.log("[DONATE] TX:", tx);
  });

  it("has correct data for jar account", async () => {
    const [jarPDA] = await PublicKey.findProgramAddress(
      [Buffer.from("jar"), wallet.publicKey.toBuffer()],
      programId
    );

    const { data, ...jarAccount } = await connection.getAccountInfo(jarPDA);

    console.log(jarAccount);
    data.slice();
    fs.writeFile("./data.json", JSON.stringify(data, null, 2));
    const decodedData = JarAccountState.decode(data);

    expect(jarAccount.lamports).toBe(LAMPORTS_PER_SOL / 2);
    expect(jarAccount.owner).toBe(programId);
    expect(jarAccount.executable).toBe(false);
    expect(decodedData.authority).toBe(wallet.publicKey.toBase58());
    expect(decodedData.donationAmount).toBe(2);
    expect(decodedData.lastDonationTime).toBeGreaterThan(0);
  });

  // Give back all lamports to the system
  afterAll(async () => {
    try {
      console.log("Attempting to give back lamports to the system...");
      const transaction = new Transaction();

      const balancesPromises = [];
      for (let index = 0; index < giveback.length; index++) {
        const keypair = giveback[index];
        balancesPromises.push(connection.getBalance(keypair.publicKey));
      }

      const balances = await Promise.all(balancesPromises);

      console.log(`Giving back ${_.sum(balances)} lamports 🙏...`);

      giveback.forEach((keypair, index) => {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            lamports: balances[index] - MAYBE_FEE,
            toPubkey: AIRDROP_KEY,
          })
        );
      });

      const tx = await sendAndConfirmTransaction(
        connection,
        transaction,
        giveback
      );

      console.log("Gave back all lamports to the system 🚀:", tx);
    } catch (err) {
      console.error(err);
      console.log("Could not give back lamports to the system :(");
      console.log(
        "Please manually give back lamports to the system, saved keys data to ./giveback.json"
      );
      fs.writeFile("giveback.json", JSON.stringify(giveback, null, 2));
    }
  }, 100_000);
});
