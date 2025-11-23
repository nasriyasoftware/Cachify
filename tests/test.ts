import cachify from "../src";

const alice = { key: "alice", scope: "users", status: "online" };
const bob = { key: "bob", scope: "users", status: "offline" };

// Seed cache
await cachify.kvs.set(alice.key, alice, { scope: "users" });
await cachify.kvs.set(bob.key, bob, { scope: "users" });

// Create sessions
const session1 = cachify.kvs.createLockSession();
const session2 = cachify.kvs.createLockSession({ timeout: 2000 });

async function updateAliceStatus() {
    // Acquire Alice record
    await session1.acquire([alice]);

    // Modify Alice safely
    alice.status = "away";
    await session1.records.update(alice.key, alice, "users");

    // Release the session, allowing others to acquire
    session1.release();
}

async function waitAndUpdateAlice() {
    // Session2 will wait to acquire Alice until session1 releases
    await session2.acquire([alice]);

    const aliceRecord = await session2.records.read<typeof alice>(alice.key, "users");
    console.log(aliceRecord?.status); // "away"

    aliceRecord!.status = "busy";
    await session2.records.update(alice.key, aliceRecord!, "users");
    session2.release();
}

await Promise.all([updateAliceStatus(), waitAndUpdateAlice()]);

// Read directly from cache
const finalAlice = await cachify.kvs.read<typeof alice>(alice.key, "users");
console.log(finalAlice?.status); // "busy"