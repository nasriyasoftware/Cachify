import atomix from "@nasriya/atomix";
import cron, { ScheduledTimedTask } from "@nasriya/cron";

import kvEventsManager from "../../events/managers/kv/KVEventsManager";
import TTLItemConfig from "../../configs/strategies/ttl/TTLItemConfig";
import engineProxy from "../../engines/proxy";
import type { KVSetConfigs } from "./docs";

class KVCacheRecord {
    readonly #_flavor: 'kv' = 'kv';
    readonly #_engines: string[] = [];
    readonly #_scope: string = 'global';
    readonly #_key: string;
    readonly #_ttl: TTLItemConfig | undefined;
    #_expireJob: ScheduledTimedTask = {} as unknown as ScheduledTimedTask;
    #_initialized = false;

    readonly #_stats = {
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

    constructor(key: string, configs: KVSetConfigs) {
        this.#_key = key;
        this.#_scope = configs.scope;
        this.#_engines = configs.storeIn;
        if (configs.ttl.value > 0) {
            this.#_ttl = new TTLItemConfig(configs.ttl);
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

        kvEventsManager.on('remove', (event) => {
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
            await engineProxy.set(this, value);
            this.#_helpers.refreshTTL();
            await kvEventsManager.emit.create(this, { preload: preload });
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
            this.#_expireJob = cron.scheduleTime(expireAt, async () => {
                this.#_ttl?.onExpire?.(this);
                await kvEventsManager.emit.expire(this);
            });
        },
        registerAccess: () => {
            this.#_stats.dates.lastUpdate = Date.now();
            this.#_helpers.refreshTTL();
        }
    }

    /**
     * Retrieves the flavor of the cache record.
     * @returns {'kv'} The flavor of the cache record.
     */
    get flavor(): 'kv' { return this.#_flavor }

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
    async read(): Promise<unknown> {
        this.#_stats.counts.read++;
        this.#_helpers.registerAccess();
        const response = await engineProxy.read(this);
        return response.value;
    }

    /**
     * Updates the value associated with the cache record.
     * The method emits an 'update' event after updating the record's value.
     * @param value - The new value to be associated with the cache record.
     * @since v1.0.0
     */
    async update(value: unknown) {
        await engineProxy.set(this, value);
        this.#_stats.counts.update++;
        await kvEventsManager.emit.update(this);
    }

    /**
     * Updates the record's last access date and emits a `touch` event.
     * This method is used to update the record's metadata without modifying the value.
     */
    async touch() {
        this.#_stats.counts.touch++;
        this.#_helpers.registerAccess();
        await kvEventsManager.emit.touch(this);
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
        const response = await engineProxy.read(this);
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