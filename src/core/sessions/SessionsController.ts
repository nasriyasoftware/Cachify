import uuidX from "@nasriya/uuidx";
import CacheSession from "./CacheSession";
import atomix from "@nasriya/atomix";
import KVCacheRecord from "../flavors/kvs/kvs.record";
import type { KVCacheController } from "../flavors/kvs/docs";
import type { SessionConfigs, SessionId, SessionOptions, SessionPolicy, SessionRecordMeta } from "./docs";
import SessionError from "./errors/SessionError";

const hasOwnProp = atomix.dataTypes.record.hasOwnProperty;

class SessionsController {
    readonly #_sessions: Map<SessionId, CacheSession> = new Map();
    readonly #_cacheController: KVCacheController;
    readonly #_pending: Map<KVCacheRecord, CacheSession> = new Map();

    constructor(cacheController: KVCacheController) {
        this.#_cacheController = cacheController;
    }

    readonly #_configs = {
        policy: {
            blockRead: false,
            exclusive: false
        } as SessionPolicy,
    }

    readonly #_helpers = {
        createIterator: function* (sessions: Map<SessionId, CacheSession>) {
            for (const [sessionId, session] of sessions) {
                for (const record of session.lockedRecords) {
                    yield { session, record };
                }
            }
        },
        generateSessionId: (): SessionId => {
            while (true) {
                const id = uuidX.v4() as SessionId;
                if (!this.#_sessions.has(id)) { return id }
            }
        },
        parseRecordsMetadata(meta: SessionRecordMeta | SessionRecordMeta[]): Required<SessionRecordMeta>[] {
            if (meta === undefined) {
                return [];
            }

            if (!Array.isArray(meta)) {
                meta = [meta];
            }

            const parsedMetas: Required<SessionRecordMeta>[] = [];
            for (const recordMetaOptions of meta) {
                if (!atomix.valueIs.record(recordMetaOptions)) {
                    throw new TypeError(`Expected "recordsMeta" to either be a meta record or an array of meta records, but instead got ${typeof recordMetaOptions}`);
                }

                const recMeta: Required<SessionRecordMeta> = { key: '', scope: 'global' };

                if (hasOwnProp(recordMetaOptions, 'key')) {
                    if (!atomix.valueIs.string(recordMetaOptions.key)) {
                        throw new TypeError(`The "key" property of the "recordsMeta" object must be a string, but instead got ${typeof recordMetaOptions.key}`);
                    }

                    if (recordMetaOptions.key.trim().length === 0) {
                        throw new RangeError(`The "key" property of the "recordsMeta" object must be a non-empty string`);
                    }

                    recMeta.key = recordMetaOptions.key.trim();
                } else {
                    throw new SyntaxError(`The "key" property of the "recordsMeta" object is required and missing.`);
                }

                if (hasOwnProp(recordMetaOptions, 'scope')) {
                    if (!atomix.valueIs.string(recordMetaOptions.scope)) {
                        throw new TypeError(`The "scope" property of the "recordsMeta" object (when provided) must be a string, but instead got ${typeof recordMetaOptions.scope}`);
                    }

                    if (recordMetaOptions.scope.trim().length === 0) {
                        throw new RangeError(`The "scope" property of the "recordsMeta" object (when provided) must be a non-empty string`);
                    }

                    recMeta.scope = recordMetaOptions.scope.trim();
                }

                parsedMetas.push(recMeta);
            }

            return parsedMetas;
        }
    }

    /**
     * Creates a new cache session.
     *
     * The created session has a unique session ID, which can be accessed using the `id` property.
     * The session is automatically added to the internal map of sessions.
     *
     * @returns {CacheSession} The newly created cache session.
     * @since v1.0.0
     */
    createSession(options?: SessionOptions): CacheSession {
        const sessionId = this.#_helpers.generateSessionId();

        try {
            const configs: SessionConfigs = {
                id: sessionId,
                controller: this,
                cacheController: this.#_cacheController,
                policy: atomix.dataTypes.object.smartClone(this.#_configs.policy),
                timeout: 10_000
            }

            if (options !== undefined) {
                if (!atomix.valueIs.record(options)) { throw new TypeError(`The "options" parameter must be a record, but instead got ${typeof options}`) }

                if (hasOwnProp(options, 'timeout')) {
                    if (!atomix.valueIs.number(options.timeout)) { throw new TypeError(`The "timeout" property of the "options" object (when provided) must be a number, but instead got ${typeof options.timeout}`) }
                    if (!atomix.valueIs.integer(options.timeout)) { throw new TypeError(`The "timeout" property of the "options" object must be an integer, but instead got ${options.timeout}`) }
                    if (options.timeout < 0) { throw new RangeError(`The "timeout" property of the "options" object must either be 0 or a positive number, but instead got ${options.timeout}`) }
                    configs.timeout = options.timeout;
                }

                if (hasOwnProp(options, 'policy')) {
                    if (!atomix.valueIs.record(options.policy)) { throw new TypeError(`The "policy" property of the "options" object (when provided) must be a record, but instead got ${typeof options.policy}`) }
                    const policy = options.policy;

                    if (hasOwnProp(policy, 'blockRead')) {
                        if (typeof policy.blockRead !== 'boolean') { throw new TypeError(`The "blockRead" property of the "policy" object (when provided) must be a boolean, but instead got ${typeof policy.blockRead}`) }
                        configs.policy.blockRead = policy.blockRead;
                    }

                    if (hasOwnProp(policy, 'exclusive')) {
                        if (typeof policy.exclusive !== 'boolean') { throw new TypeError(`The "exclusive" property of the "policy" object (when provided) must be a boolean, but instead got ${typeof policy.exclusive}`) }
                        configs.policy.exclusive = policy.exclusive;
                        if (policy.exclusive) { configs.timeout = 0; }
                    }
                }
            }

            // Creating the session
            const session = new CacheSession(configs);

            // Storing the session in memory
            this.#_sessions.set(sessionId, session);

            // Returning the session to be used.
            return session;
        } catch (error) {
            if (this.#_sessions.has(sessionId)) {
                this.#_sessions.delete(sessionId);
            }

            if (error instanceof Error) {
                error.message = `Failed to create session: ${error.message}`;
            }

            throw error
        }
    }

    /**
     * Acquires the records associated with the given metadata for the given session.
     * If any of the records are currently locked by another session, this method will block until those records
     * are released.
     * If any of the records cannot be acquired, this method will throw an error.
     * @param recordsMeta - The metadata of the records to acquire, which can be a single meta record or an array of meta records.
     * @param session - The session to acquire the records for.
     * @returns A promise that resolves to an array of records associated with the given metadata.
     * @throws {Error} Thrown if any of the records cannot be acquired.
     */
    async acquire(recordsMeta: SessionRecordMeta | SessionRecordMeta[], session: CacheSession) {
        const parsedMetas = this.#_helpers.parseRecordsMetadata(recordsMeta);
        const records: Set<KVCacheRecord> = new Set();

        for (const meta of parsedMetas) {
            const record = this.#_cacheController.get(meta.key, meta.scope);
            if (!record) { continue };

            if (this.#_pending.has(record)) {
                const session = this.#_pending.get(record)!;
                await session.untilReleased().catch((err) => {
                    if (err instanceof SessionError && err.code === 'SESSION_TIMEOUT') { return; }
                    throw err;
                });
            }

            records.add(record);
            this.#_pending.set(record, session);
        }

        return records;
    }

    /**
     * Marks the given records as locked by the current session.
     * This method removes the records from the pending records map, effectively marking them as locked.
     * @param records - The records to mark as locked, which can be a single record or an array of records.
     * @since v1.0.0
     */
    markAsLocked(records: KVCacheRecord | KVCacheRecord[]) {
        if (!Array.isArray(records)) { records = [records] }
        for (const record of records) {
            this.#_pending.delete(record);
        }
    }

    /**
     * Retrieves the map of active cache sessions.
     *
     * @returns The map of active cache sessions.
     * @since v1.0.0
     */
    get sessions() { return this.#_sessions }
}

export default SessionsController;