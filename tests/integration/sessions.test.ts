import cachify from "..";
import overwatch from "@nasriya/overwatch";
import { cleanup } from '../helpers/helpers';
import { SessionRecordMeta } from "../../src/core/sessions/docs";
import SessionError from "../../src/core/sessions/errors/SessionError";
import { SessionErrorCode } from "../../src/core/sessions/errors/error_codes";

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

    const expectSessionError = async (fn: () => Promise<any>, code: SessionErrorCode, msg: RegExp) => {
        try {
            await fn();
            expect('operation to be rejected').toBe(true);
        } catch (err) {
            expect(err).toBeInstanceOf(SessionError);
            const error = err as SessionError;
            expect(error.code).toBe(code);
            expect(error.message).toMatch(msg);
        }
    }

    // -------------------------------------------------------------------------
    // 1. Read blocking
    // -------------------------------------------------------------------------
    it("blocks read via another session until record is released", async () => {
        const s1 = cachify.kvs.createLockSession();
        const s2 = cachify.kvs.createLockSession({ timeout: 2000 });

        await s1.acquire([ahmad]);

        let started = false;
        let finished = false;
        let value: any;

        const p = (async () => {
            started = true;
            value = await s2.records.read(ahmad.key, ahmad.scope); // blocked
            finished = true;
        })();

        await new Promise(r => setTimeout(r, 10));
        expect(started).toBe(true);
        expect(finished).toBe(false);

        s1.release();
        await p;

        expect(finished).toBe(true);
        expect(value.key).toBe("ahmad");

        s2.release();
    });

    // -------------------------------------------------------------------------
    // 2. Read blocking via cache manager (not via session)
    // -------------------------------------------------------------------------
    it("blocks read via cache manager when record is locked", async () => {
        const s1 = cachify.kvs.createLockSession();
        await s1.acquire([suzy]);

        let started = false;
        let finished = false;

        const p = (async () => {
            started = true;
            await cachify.kvs.read(suzy.key, suzy.scope); // must block
            finished = true;
        })();

        await new Promise(r => setTimeout(r, 10));
        expect(started).toBe(true);
        expect(finished).toBe(false);

        s1.release();
        await p;

        expect(finished).toBe(true);
    });

    // -------------------------------------------------------------------------
    // 3. Updating / removing by non-owner throws
    // -------------------------------------------------------------------------
    it("throws when a non-owner session attempts update or remove", async () => {
        const s1 = cachify.kvs.createLockSession();
        const s2 = cachify.kvs.createLockSession({ timeout: 2000 });

        await s1.acquire([omar]);

        // Update forbidden: should throw immediately (not block)
        await expectSessionError(
            () => s2.records.update(omar.key, { ...omar, status: "online" }, omar.scope),
            'SESSION_RECORD_NOT_ACQUIRED',
            /has not been acquired by this session/
        );

        // // Remove forbidden: should throw immediately
        await expectSessionError(
            () => s2.records.remove(omar.key, omar.scope),
            'SESSION_RECORD_NOT_ACQUIRED',
            /has not been acquired by this session/
        );

        s1.release();
    });

    // -------------------------------------------------------------------------
    // 4. acquire() blocks other sessions until record is released
    // -------------------------------------------------------------------------
    it("blocks session2 acquire until session1 releases", async () => {
        const s1 = cachify.kvs.createLockSession();
        const s2 = cachify.kvs.createLockSession({ timeout: 2000 });

        await s1.acquire([omar]);

        let started = false;
        let finished = false;

        const p = (async () => {
            started = true;
            await s2.acquire([omar]); // blocks
            finished = true;
        })();

        await new Promise(r => setTimeout(r, 10));
        expect(started).toBe(true);
        expect(finished).toBe(false);

        s1.release();
        await p;

        expect(finished).toBe(true);

        await s2.records.update(omar.key, { ...omar, status: "online" }, omar.scope);
        const updated = await cachify.kvs.read<Profile<typeof omar>>(omar.key, omar.scope);

        expect(updated!.status).toBe("online");

        s2.release();
    });

    // -------------------------------------------------------------------------
    // 5. Exclusive sessions prevent locking by others
    // -------------------------------------------------------------------------
    it("throws when another session tries to lock an exclusive record", async () => {
        const s1 = cachify.kvs.createLockSession({
            policy: { exclusive: true }
        });

        const s2 = cachify.kvs.createLockSession({ timeout: 2000 });

        await s1.acquire([ahmad]); // exclusive lock

        // Trying to lock the same record must throw synchronously
        await expectSessionError(
            () => s2.acquire([ahmad]),
            'SESSION_RECORD_IS_EXCLUSIVE',
            /is exclusive and cannot be locked by another session./
        );

        s1.release();
    });

    // -------------------------------------------------------------------------
    // 6. Read is still allowed while exclusive, but blocked until release
    // -------------------------------------------------------------------------
    it("allows other sessions to read an exclusive record but blocks until release", async () => {
        const s1 = cachify.kvs.createLockSession({
            policy: { exclusive: true }
        });

        const s2 = cachify.kvs.createLockSession({ timeout: 2000 });

        await s1.acquire([suzy]);

        let started = false;
        let finished = false;

        const p = (async () => {
            started = true;
            await s2.records.read(suzy.key, suzy.scope);
            finished = true;
        })();

        await new Promise(r => setTimeout(r, 10));
        expect(started).toBe(true);
        expect(finished).toBe(false);

        s1.release();
        await p;

        expect(finished).toBe(true);
    });

    // -------------------------------------------------------------------------
    // 7. timeout: 0 → never timeout (infinite wait allowed)
    // -------------------------------------------------------------------------
    it("allows sessions with timeout=0 to wait indefinitely", async () => {
        const s1 = cachify.kvs.createLockSession({ timeout: 0 }); // never timeout
        const s2 = cachify.kvs.createLockSession();

        await s1.acquire([omar]);

        let started = false;
        let finished = false;

        const p = (async () => {
            started = true;
            await s2.acquire([omar]); // infinite wait allowed
            finished = true;
        })();

        await new Promise(r => setTimeout(r, 50));
        expect(started).toBe(true);
        expect(finished).toBe(false); // still waiting

        s1.release();
        await p;

        expect(finished).toBe(true);
        s2.release();
    });

    // -------------------------------------------------------------------------
    // 8. Normal timeout → session automatically releases its records after timeout
    // -------------------------------------------------------------------------
    it("allows waiting sessions to acquire records after owner session times out", async () => {
        const s1 = cachify.kvs.createLockSession({ timeout: 50 }); // will timeout quickly
        const s2 = cachify.kvs.createLockSession(); // normal timeout

        await s1.acquire([ahmad]);

        let s2Acquired = false;
        const s2Promise = (async () => {
            await s2.acquire([ahmad]); // should wait until s1 releases
            s2Acquired = s2.lockedRecords.size === 1;
        })();

        // Wait enough time for s1 to timeout
        await new Promise((r) => setTimeout(r, 100));

        await s2Promise;

        expect(s2Acquired).toBe(true);

        s2.release();
    });
});