import atomix from "@nasriya/atomix";
import cron, { ScheduledTimedTask } from "@nasriya/cron";

import KVsEventsManager from "../../events/managers/kvs/KVsEventsManager";
import EnginesProxy from "../../engines/EnginesProxy";
import TTLItemConfig from "../../configs/strategies/ttl/TTLItemConfig";
import helpers from "../helpers";
import CacheSession from "../../sessions/CacheSession";
import SessionError from "../../sessions/errors/SessionError";
import type { SessionId } from "../../sessions/docs";
import type { KVSetConfigs } from "./docs";

class KVCacheRecord {
    readonly #_flavor: 'kvs' = 'kvs';
    readonly #_engines: string[] = [];
    readonly #_proxy: EnginesProxy;
    readonly #_events: KVsEventsManager;
    readonly #_scope: string = 'global';
    readonly #_key: string;
    readonly #_ttl: TTLItemConfig<'kvs'> | undefined;
    #_expireJob: ScheduledTimedTask = {} as unknown as ScheduledTimedTask;
    #_session?: CacheSession;
    #_initialized = false;

    readonly #_stats = {
        size: 0,
        dates: {
            created: 0,
            expireAt: undefined as number | undefined,
            lastAccess: undefined as number | undefined,
            lastUpdate: undefined as number | undefined
        },
        counts: {
            read: 0,
            update: 0,
            touch: 0,
            hit: 0,
            miss: 0
        }
    }

    constructor(key: string, configs: KVSetConfigs, proxy: EnginesProxy, events: KVsEventsManager) {
        this.#_proxy = proxy;
        this.#_events = events;

        this.#_key = key;
        this.#_scope = configs.scope;
        this.#_engines = configs.storeIn;
        if (configs.ttl.value > 0) {
            this.#_ttl = new TTLItemConfig(configs.ttl, 'kvs');
        }

        if (configs.preload) {
            switch (configs.initiator) {
                case 'warmup': {
                    this.#_stats.dates.created = Date.now();
                }
                    break;

                case 'restore': {
                    this.#_stats = configs.stats;

                }
                    break;
            }
        } else {
            this.#_stats.dates.created = Date.now();
        }

        this.#_events.on('remove', (event) => {
            if (event.item.key === this.#_key) {
                this.#_expireJob?.cancel?.();
            }
        }, { once: true });
    }

    /**
     * Initializes the key-value cache record by storing the given value across engines
     * and setting the record's internal state and TTL.
     * 
     * If the record is already initialized, this method does nothing.
     * 
     * @param value - The value to be stored in the cache record.
     * @param preload - Whether to preload the record upon creation.
     * @private
     */
    async _init(value: unknown, preload: boolean) {
        try {
            if (this.#_initialized) { return }
            this.#_stats.size = helpers.records.estimateSize(this.#_key, value);
            await this.#_proxy.set(this, value);
            this.#_helpers.refreshTTL();
            await this.#_events.emit.create(this, { preload: preload });
        } catch (error) {
            throw error;
        } finally {
            this.#_initialized = true;
        }
    }

    readonly #_helpers = {
        refreshTTL: () => {
            const ttlConfig = this.#_ttl;
            if (!ttlConfig) { return }
            const ttl = this.#_ttl.value
            if (ttl === 0) { return }

            const sliding = this.#_ttl.sliding;
            const baseTime = sliding ?
                this.#_stats.dates.lastAccess || this.#_stats.dates.created :
                this.#_stats.dates.created;

            const expireAt = baseTime + ttl;
            if (expireAt === this.#_stats.dates.expireAt) { return }

            this.#_stats.dates.expireAt = expireAt;
            this.#_expireJob?.cancel?.();

            const policy = ttlConfig.policy;
            if (policy === 'evict') {
                this.#_expireJob = cron.scheduleTime(expireAt, async () => {
                    this.#_ttl?.onExpire?.(this);
                    await this.#_events.emit.expire(this);
                });
            }

        },
        register: {
            update: () => {
                this.#_stats.counts.update++;
                this.#_stats.dates.lastUpdate = Date.now();
                this.#_helpers.refreshTTL();
            },
            read: () => {
                this.#_stats.counts.read++;
                this.#_helpers.register.access();
            },
            access: () => {
                this.#_stats.dates.lastAccess = Date.now();
            }
        }
    }

    /**
     * Locks the cache record for the given session, ensuring that the associated records are not modified
     * until the session is released.
     * @param {CacheSession} session - The session to acquire the cache record for.
     * @returns {Promise<void>}
     */
    async lock(session: CacheSession): Promise<void> {
        if (this.#_session) {
            if (this.#_session.policy.exclusive) {
                throw new SessionError('SESSION_RECORD_IS_EXCLUSIVE', {
                    message: `The record of key "${this.#_key}" and scope "${this.#_scope}" is exclusive and cannot be locked by another session.`,
                    cause: 'Attempting to lock an exclusive record'
                });
            }

            await this.#_session.untilReleased();
        }

        this.#_session = session;
        this.touch();
    }

    /**
     * Releases the cache record from the given session, allowing it to be modified by other sessions.
     * If the session ID does not match the currently locked session, this method does nothing.
     */
    release(sessionId: SessionId) {
        if (this.#_session && this.#_session!.id === sessionId) {
            this.#_session = undefined;
        }
    }

    /**
     * Retrieves a promise that resolves when this cache record is no longer locked.
     * If the cache record is currently not locked, the promise resolves immediately.
     * @returns {Promise<void>} A promise that resolves when this cache record is no longer locked.
     */
    async untilReleased(): Promise<void> {
        if (this.#_session) {
            return this.#_session.untilReleased();
        }
    }

    /**
     * Retrieves whether or not this cache record is currently locked.
     * A locked cache record indicates that the associated records are currently being accessed
     * and should not be modified until the session is released.
     * @returns {boolean} Whether or not this cache record is currently locked.
     */
    get isLocked(): boolean { return this.#_session !== undefined }

    /**
     * Retrieves whether or not this cache record is currently locked and exclusive.
     * A locked and exclusive cache record indicates that the associated records are currently being accessed
     * and should not be modified until the session is released, and that no other session can lock the record.
     * @returns {boolean} Whether or not this cache record is currently locked and exclusive.
     */
    get isExclusive(): boolean {
        return this.isLocked && this.#_session!.policy.exclusive;
    }

    /**
     * Retrieves the flavor of the cache record.
     * @returns {'kvs'} The flavor of the cache record.
     */
    get flavor(): 'kvs' { return this.#_flavor }

    /**
     * Retrieves the list of engines associated with the cache record.
     * @returns {string[]} An array of engine names.
     */
    get engines(): string[] { return this.#_engines }

    /**
     * Retrieves the key associated with the cache record.
     * @returns {string} The key associated with the cache record.
     */
    get key(): string { return this.#_key }

    /**
     * Retrieves the scope associated with the cache record.
     * @returns {string} The scope of the cache record.
     */
    get scope(): string { return this.#_scope }

    /**
     * Retrieves the statistics for the cache record.
     * The statistics include the dates of creation, last access, last update, and expiration, as well as the counts of access, update, and touch events.
     * @returns The statistics of the cache record.
     */
    get stats() {
        const cloned = atomix.dataTypes.object.smartClone(this.#_stats);
        return atomix.dataTypes.record.deepFreeze(cloned);
    }

    /**
     * Retrieves the value associated with the cache record.
     * If the record does not exist in the cache, it returns undefined.
     * The method emits a 'read' event with the reason 'hit' upon successful retrieval.
     * @returns {Promise<T>} A promise resolving with the value associated with the cache record, or undefined if no record exists.
     * @since v1.0.0
     */
    async read<T = unknown>(): Promise<T> {
        const response = await this.#_proxy.read(this);
        this.#_helpers.register.read();
        return response.value;
    }

    /**
     * Updates the value associated with the cache record.
     * The method emits an 'update' event after updating the record's value.
     * @param value - The new value to be associated with the cache record.
     * @since v1.0.0
     */
    async update(value: unknown) {
        await this.#_proxy.set(this, value);
        this.#_helpers.register.update();
        await this.#_events.emit.update(this);
    }

    /**
     * Updates the record's last access date and emits a `touch` event.
     * This method is used to update the record's metadata without modifying the value.
     */
    async touch() {
        this.#_stats.counts.touch++;
        this.#_helpers.register.access();
        await this.#_events.emit.touch(this);
    }

    /**
     * Converts the cache record to a JSON-compatible object.
     * The JSON object will contain the flavor, scope, key, statistics, value, and TTL settings of the cache record.
     * @returns The JSON object representation of the cache record.
     */
    toJSON() {
        const cloned = atomix.dataTypes.object.smartClone({
            flavor: this.#_flavor,
            engines: this.#_engines,
            scope: this.#_scope,
            key: this.#_key,
            stats: this.#_stats,
            ttl: {
                value: this.#_ttl ? this.#_ttl.value : 0,
                sliding: this.#_ttl ? this.#_ttl.sliding : false
            }
        })

        return atomix.dataTypes.record.deepFreeze(cloned);
    }

    /**
     * Exports the cache record to a JSON-compatible object.
     * The exported object will contain the flavor, scope, key, statistics, value, and TTL settings of the cache record.
     * If the record does not exist in the cache, it returns undefined.
     * 
     * This is meant to be used for backups.
     * @returns The JSON object representation of the cache record, or undefined if no record exists.
     * @since v1.0.0
     */
    async export() {
        const response = await this.#_proxy.read(this);
        if (response.value === undefined) { return undefined }

        return {
            flavor: this.#_flavor,
            engines: this.#_engines,
            scope: this.#_scope,
            key: this.#_key,
            value: response.value,
            stats: this.#_stats,
            ttl: {
                value: this.#_ttl ? this.#_ttl.value : 0,
                sliding: this.#_ttl ? this.#_ttl.sliding : false,
            },
        }
    }
}

export default KVCacheRecord;