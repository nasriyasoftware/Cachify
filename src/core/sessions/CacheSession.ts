import cachify from "../../cachify";
import SessionsController from "./SessionsController";
import KVCacheRecord from "../flavors/kvs/kvs.record";
import SessionError from "./errors/SessionError";
import type { SessionConfigs, SessionId, SessionPolicy, SessionRecordMeta } from "./docs";
import type { KVCacheController } from "../flavors/kvs/docs";

class CacheSession {
    readonly #_id: SessionId;
    readonly #_controller: SessionsController
    readonly #_cacheController: KVCacheController;
    readonly #_policy: SessionPolicy;
    readonly #_flags = Object.seal({ released: false, locking: false });
    readonly #_storage = {
        locked: new Set<KVCacheRecord>(),
        pending: new Set<KVCacheRecord>()
    }

    #_timeout: NodeJS.Timeout | undefined;
    #_sessionPromise = {
        internal: Promise.withResolvers<void>(),
        external: null as unknown as Promise<void>
    }

    readonly #_helpers = {
        setTimeout: (timeout: number) => {
            this.#_timeout = setTimeout(async () => {
                this.#_helpers.release({ timedout: true });

                if (cachify.debug) {
                    console.debug(`[Cachify:Sessions] Session ${this.#_id} timed out.`)
                }
            }, timeout);
        },
        releaseRecords: () => {
            for (const record of this.#_storage.locked.values()) {
                if (!record.locked) { continue }

                record.release(this.#_id);

                // remove after releasing
                if (this.#_storage.locked.has(record)) { this.#_storage.locked.delete(record) }
            }
        },
        release: (options?: { timedout?: boolean }) => {
            const timedout = typeof options?.timedout === 'boolean' ? options.timedout : false;
            if (this.released) { return; }

            try {
                this.#_helpers.releaseRecords();
                this.#_controller.sessions.delete(this.#_id);

                if (timedout) {
                    const timeoutError = new SessionError('SESSION_TIMEOUT', { message: `Session ${this.#_id} timed out.` });
                    this.#_sessionPromise.internal.reject(timeoutError);
                } else {
                    this.#_sessionPromise.internal.resolve();
                }
            } finally {
                this.#_flags.released = true;
                clearTimeout(this.#_timeout);
                this.#_timeout = undefined;
            }
        }
    }

    readonly #_locker = {
        iterator: null as unknown as MapIterator<KVCacheRecord>,
        promiseData: null as unknown as PromiseWithResolvers<void>,
        next: () => {
            return this.#_locker.iterator.next().value;
        },
        hasNext: () => this.#_storage.pending.size > 0,
        run: async () => {
            // initialize iterator over pending values (MapIterator)
            this.#_locker.iterator = this.#_storage.pending.values();

            // if another run is active, return that run's promise (queue)
            if (this.#_flags.locking) {
                return this.#_locker.promiseData.promise;
            }

            // create new promise data for this run
            this.#_flags.locking = true;
            this.#_locker.promiseData = Promise.withResolvers();

            try {
                // iterate until pending is empty
                while (this.#_locker.hasNext()) {
                    const record = this.#_locker.next()!;
                    // await lock acquisition per record (caller may wait or queue internally)
                    await record.lock(this);

                    this.#_storage.locked.add(record);
                    this.#_storage.pending.delete(record);
                    this.#_controller.markAsLocked(record);
                }

                this.#_locker.promiseData.resolve();
            } catch (error) {
                this.#_locker.promiseData.reject(error)
            } finally {
                this.#_flags.locking = false;
                return this.#_locker.promiseData.promise;
            }
        }
    }

    constructor(configs: SessionConfigs) {
        this.#_sessionPromise.external = this.#_sessionPromise.internal.promise.catch(err => {
            if (err instanceof SessionError && err.code === 'SESSION_TIMEOUT') { return; }
            throw err;
        });

        this.#_id = configs.id;
        this.#_controller = configs.controller;
        this.#_cacheController = configs.cacheController;
        this.#_policy = Object.freeze(configs.policy);
        this.#_helpers.setTimeout(configs.timeout);
    }

    /**
     * Acquires the records for the session and locks them for modification.
     * The records are identified by their metadata, which can be a single meta record or an array of meta records.
     * The method returns a promise that resolves when all records have been acquired and locked.
     * If any of the records cannot be acquired, or if the session has been released, the method throws an error.
     * @param recordsMeta - The metadata of the records to acquire, which can be a single meta record or an array of meta records.
     * @returns A promise that resolves when all records have been acquired and locked.
     * @throws {SessionError} Thrown if the session has been released, or if any of the records cannot be acquired.
     */
    async acquire(recordsMeta: SessionRecordMeta | SessionRecordMeta[]): Promise<void> {
        try {
            if (this.#_flags.released) {
                throw new SessionError('SESSIION_ALREADY_RELEASED', { message: `The session has already been released.` });
            }

            const records = await this.#_controller.acquire(recordsMeta, this);
            for (const record of records) {
                this.#_storage.pending.add(record);
            }

            if (this.#_storage.pending.size === 0) {
                return;
            }

            return await this.#_locker.run();
        } catch (error) {
            if (error instanceof Error) {
                error.message = `Failed to acquire records for session ${this.id}: ${error.message}`
            }

            throw error;
        }
    }

    /**
     * Provides access to the records for the session.
     * @since v1.0.0
     */
    readonly records = {
        /**
         * Retrieves the value associated with the given cache record key.
         * The method returns a promise that resolves with the value associated with the cache record.
         * If the record does not exist in the cache, or if the session has not acquired the record, the method throws an error.
         * @param key - The key of the record to retrieve the value for.
         * @param scope - The scope of the record to retrieve the value for. Defaults to 'global'.
         * @returns A promise that resolves with the value associated with the cache record.
         * @throws {SessionError} Thrown if the record does not exist in the cache, or if the session has not acquired the record.
         * The error contains a summary of which engines failed and why.
         * @since v1.0.0
         */
        read: <T>(key: string, scope: string = 'global'): Promise<T | undefined> => {
            try {
                if (this.#_flags.released) {
                    new SessionError('SESSIION_ALREADY_RELEASED', { message: `The session has already been released.` });
                }

                const record = this.#_cacheController.get(key, scope);
                if (!record) {
                    throw new SessionError('SESSION_RECORD_NOT_FOUND', {
                        message: `Record with key "${key}" and scope "${scope}" not found. Possibly removed from the cache`,
                        cause: 'Attempting to read a record that does not exist in the cache'
                    });
                }

                if (this.#_storage.locked.has(record)) {
                    return this.#_cacheController.read(key, scope, this);
                } else {
                    return this.#_cacheController.read(key, scope);
                }
            } catch (error) {
                if (error instanceof Error) {
                    error.message = `Failed to read record for session ${this.id}: ${error.message}`
                }

                throw error;
            }
        },

        /**
         * Updates a record in the cache with a new value.
         * The method returns a promise that resolves when the record has been updated.
         * If the record does not exist in the cache, or if the session has not acquired the record, the method throws an error.
         * @param key - The key of the record to update.
         * @param value - The new value for the record.
         * @param scope - The scope of the record to update. Defaults to 'global'.
         * @returns A promise that resolves when the record has been updated.
         * @throws {SessionError} Thrown if the record does not exist in the cache, or if the session has not acquired the record.
         * The error contains a summary of which engines failed and why.
         * @since v1.0.0
         */
        update: <T>(key: string, value: T, scope: string = 'global'): Promise<void> => {
            try {
                if (this.#_flags.released) {
                    throw new SessionError('SESSIION_ALREADY_RELEASED', { message: `The session has already been released.` });
                }

                const record = this.#_cacheController.get(key, scope);
                if (!record) {
                    throw new SessionError('SESSION_RECORD_NOT_FOUND', {
                        message: `Record with key "${key}" and scope "${scope}" not found. Possibly removed from the cache`,
                        cause: 'Attempting to update a record that does not exist in the cache'
                    });
                }

                if (!this.#_storage.locked.has(record)) {
                    throw new SessionError('SESSION_RECORD_NOT_ACQUIRED', {
                        message: `Record with key "${key}" and scope "${scope}" has not been acquired by this session.`,
                        cause: 'Attempting to update a record that has not been acquired by this session'
                    });
                }

                return this.#_cacheController.update(record, value, this);
            } catch (error) {
                if (error instanceof Error) {
                    error.message = `Failed to update record for session ${this.id}: ${error.message}`
                }

                throw error;
            }
        },

        remove: async (key: string, scope: string = 'global'): Promise<boolean> => {
            try {
                if (this.#_flags.released) {
                    throw new SessionError('SESSIION_ALREADY_RELEASED', { message: `The session has already been released.` });
                }

                const record = this.#_cacheController.get(key, scope);
                if (!record) {
                    return false;
                }

                if (!this.#_storage.locked.has(record)) {
                    throw new SessionError('SESSION_RECORD_NOT_ACQUIRED', {
                        message: `Record with key "${key}" and scope "${scope}" has not been acquired by this session.`,
                        cause: 'Attempting to remove a record that has not been acquired by this session'
                    })
                }

                const isRemoved = await this.#_cacheController.remove(key, scope, this);
                if (isRemoved) {
                    this.#_storage.locked.delete(record);
                }

                return isRemoved;
            } catch (error) {
                if (error instanceof Error) {
                    error.message = `Failed to remove record for session ${this.id}: ${error.message}`
                }

                throw error;
            }
        },
    }

    /**
     * Retrieves the unique session ID associated with this cache session.
     * @returns {SessionId} The unique session ID associated with this cache session.
     * @since v1.0.0
     */
    get id(): SessionId { return this.#_id }

    /**
     * Retrieves whether or not this cache session has been released.
     * A released cache session indicates that the associated records are no longer
     * accessible and should not be modified.
     * @returns {boolean} Whether or not this cache session has been released.
     * @since v1.0.0
     */
    get released(): boolean { return this.#_flags.released }

    /**
     * Retrieves a set of records that are currently locked by this session.
     * The set contains all records that have been acquired by this session and are currently being modified.
     * @returns {Set<KVCacheRecord>} A set of records that are currently locked by this session.
     * @since v1.0.0
     */
    get lockedRecords(): Set<KVCacheRecord> { return this.#_storage.locked }

    /**
     * Retrieves a set of records that are currently pending release by this session.
     * The set contains all records that have been acquired by this session and are currently being modified.
     * @returns {Set<KVCacheRecord>} A set of records that are currently pending release by this session.
     * @since v1.0.0
     */
    get pendingRecords(): Set<KVCacheRecord> { return this.#_storage.pending }

    /**
     * Retrieves the policy associated with this cache session.
     * The policy determines the behavior of the cache session, such as whether records are automatically released when the session is released.
     * @returns {SessionPolicy} The policy associated with this cache session.
     * @since v1.0.0
     */
    get policy(): SessionPolicy { return this.#_policy }

    /**
     * Retrieves a promise that resolves when this cache session is released.
     * @returns {Promise<void>} A promise that resolves when this cache session is released.
     * @since v1.0.0
     */
    async untilReleased(): Promise<void> {
        if (this.#_flags.released) { return }
        return this.#_sessionPromise.external;
    }

    /**
     * Releases this cache session, allowing any associated records to be modified by other sessions.
     * After calling this method, any records associated with this cache session will be
     * inaccessible and should not be modified.
     * @since v1.0.0
     */
    release(): void {
        this.#_helpers.release();
        if (cachify.debug) {
            console.debug(`[Cachify:Sessions] Session ${this.#_id} released.`);
        }
    }
}

export default CacheSession;