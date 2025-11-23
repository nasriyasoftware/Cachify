import cachify from "..";
import overwatch from "@nasriya/overwatch";
import { cleanup } from '../helpers/helpers';
import { SessionRecordMeta } from "../../src/core/sessions/docs";

type Profile<T extends SessionRecordMeta> = {
    username: T["key"];
    status: "online" | "offline";
}

const ahmad: SessionRecordMeta = { key: "ahmad", scope: "users" };
const omar: SessionRecordMeta = { key: "omar", scope: "users" };
const suzy: SessionRecordMeta = { key: "suzy", scope: "users" };

describe("LockSession concurrency", () => {
    beforeAll(async () => {
        overwatch.control.resume();

        await Promise.all([
            cachify.kvs.set(ahmad.key, ahmad, { scope: "users" }),
            cachify.kvs.set(omar.key, omar, { scope: "users" }),
            cachify.kvs.set(suzy.key, suzy, { scope: "users" }),
        ])
    });

    afterAll(async () => {
        await cleanup();
    })

    it("should block reads from other sessions until record is released", async () => {
        const session1 = cachify.kvs.createLockSession();
        const session2 = cachify.kvs.createLockSession({ timeout: 2000 });

        // Session1 acquires ahmad and suzy
        await session1.acquire([ahmad, suzy]);
        expect(session1.lockedRecords.size).toBe(2);

        let session2ReadStarted = false;
        let session2ReadCompleted = false;
        let readValue: any;

        // Session2 tries to read suzy
        const s2Promise = (async () => {
            session2ReadStarted = true;
            readValue = await session2.records.read("suzy", "users");
            session2ReadCompleted = true;
        })();

        await new Promise(r => setTimeout(r, 10));
        expect(session2ReadStarted).toBe(true);
        expect(session2ReadCompleted).toBe(false); // Should still be waiting

        // Release S1 → this should unblock S2
        session1.release();

        await s2Promise;
        expect(session2ReadCompleted).toBe(true);
        expect(readValue.key).toBe("suzy");

        session2.release();
    });

    it("should block session2 acquire until session1 releases the record", async () => {
        const session1 = cachify.kvs.createLockSession();
        const session2 = cachify.kvs.createLockSession({ timeout: 2000 });

        // Session1 acquires omar
        await session1.acquire([omar]);

        let s2AcquireStarted = false;
        let s2AcquireCompleted = false;

        const s2Promise = (async () => {
            s2AcquireStarted = true;
            await session2.acquire([omar]); // blocks here until session1 releases
            s2AcquireCompleted = true;
        })();

        await new Promise(r => setTimeout(r, 10));
        expect(s2AcquireStarted).toBe(true);
        expect(s2AcquireCompleted).toBe(false); // still blocked

        session1.release(); // unblocks session2

        await s2Promise;
        expect(s2AcquireCompleted).toBe(true);

        await session2.records.update("omar", { ...omar, status: "online" }, "users");
        const updated = await cachify.kvs.read<Profile<typeof omar>>("omar", "users");
        expect(updated!.status).toBe("online");

        session2.release();
    });
});