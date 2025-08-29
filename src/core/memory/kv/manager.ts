import atomix from "@nasriya/atomix";
import cron, { ScheduledTask } from "@nasriya/cron";

import KVCacheRecord from "./record";
import KVCacheConfig from "../../configs/managers/kv/KVCacheConfig";
import kvEventsManager from "../../events/managers/kv/KVEventsManager";
import helpers from "../helpers";

import { CacheStatusChangeHandler } from "../../configs/strategies/docs";
import { TasksQueue, BaseQueueTask } from "@nasriya/atomix/tools";

import engineProxy from "../../engines/proxy";
import persistenceProxy from "../../persistence/proxy";
import kvHelpers from "./helpers";
import { BackupParameters, RestoreParameters, StorageServices } from "../../persistence/docs";
import { BlockingFlags, BlockingProcess } from "../../docs/docs";
import { KVSetOptions, KVSetConfigs } from "./docs";

class KVCacheManager {
    readonly #_records: KVMainRecords = new Map();
    readonly #_configs: KVCacheConfig;
    readonly #_queue = new atomix.tools.TasksQueue({ autoRun: true });
    readonly #_jobs = { clearIdleItems: undefined as unknown as ScheduledTask }
    readonly #_flags = {
        blocking: { clearing: false, backingUp: false, restoring: false } as BlockingFlags
    }

    constructor() {
        // Prepare the manager's configs
        {
            const onCacheStatusChange: CacheStatusChangeHandler = (cache, status) => {
                if (cache === 'idle') {
                    if (status === 'enabled') {
                        this.#_jobs.clearIdleItems.start();
                    } else {
                        this.#_jobs.clearIdleItems.stop();
                    }
                }
            }

            this.#_configs = new KVCacheConfig(onCacheStatusChange);
        }

        // Prepare the scheduled task to clean up idle items
        {
            this.#_jobs.clearIdleItems = cron.schedule(
                cron.time.every(5).minutes(),
                this.#_helpers.cacheManagement.idle.createCleanHandler(),
                {
                    runOnInit: false,
                    name: 'kv_clean_idle_items'
                }
            )
        }

        // Listen on events to update stats
        {
            kvEventsManager.on('remove', async event => {
                const scopeMap = this.#_helpers.records.getScopeMap(event.item.scope);
                const record = scopeMap.get(event.item.key)!;
                await engineProxy.remove(record);
                this.#_memoryManager.handle.remove(record);
                scopeMap.delete(event.item.key);
            }, { type: 'beforeAll' });

            kvEventsManager.on('update', event => {
                this.#_stats.counts.update++;
            }, { type: 'beforeAll' });

            kvEventsManager.on('read', event => {
                this.#_stats.counts.read++;
            }, { type: 'beforeAll' });

            kvEventsManager.on('touch', event => {
                this.#_stats.counts.touch++;
            }, { type: 'beforeAll' });

            kvEventsManager.on('create', event => {
                const scopeMap = this.#_helpers.records.getScopeMap(event.item.scope);
                const record = scopeMap.get(event.item.key)!;
                this.#_memoryManager.handle.create(record);
            }, { type: 'beforeAll' });
        }
    }

    readonly #_memoryManager = {
        data: {
            sortingHandler: (a: KVCacheRecord, b: KVCacheRecord): number => {
                const aStats = a.stats;
                const bStats = b.stats;

                const aScore = aStats.counts.touch + aStats.counts.read + aStats.counts.hit;
                const bScore = bStats.counts.touch + bStats.counts.read + bStats.counts.hit;

                const aAccessTime = aStats.dates.lastAccess ?? 0;
                const bAccessTime = bStats.dates.lastAccess ?? 0;

                // Prefer older and less-used entries
                if (aScore === bScore) {
                    return aAccessTime - bAccessTime;
                }

                return aScore - bScore;
            }
        },
        helpers: {
            getRecordSize: (key: string, value: unknown) => {
                const keyLength = Buffer.byteLength(key);
                const valueLength = helpers.estimateValueSize(value);
                return keyLength + valueLength;
            },
            applyDelta: async (delta: number) => {
                this.#_stats.sizeInMemory = Math.max(this.#_stats.sizeInMemory + delta, 0);
                const sizeToFree = () => Math.max(this.#_stats.sizeInMemory - this.#_configs.maxTotalSize, 0);
                if (sizeToFree() === 0) { return }

                const taskId = `free_memory`;
                const isInQueue = this.#_queue.hasTask(taskId);
                if (isInQueue) { return }

                const task: BaseQueueTask = {
                    id: taskId,
                    type: 'free_memory',
                    priority: 2,
                    action: async () => {
                        // Get all the records accross all scopes
                        const allRecords: KVCacheRecord[] = [];
                        for (const [_, scopeMap] of this.#_records) {
                            allRecords.push(...Array.from(scopeMap.values()));
                        }

                        // Sort the records
                        allRecords.sort(this.#_memoryManager.data.sortingHandler);

                        // Attempting to free memory
                        for (const record of allRecords) {
                            if (sizeToFree() === 0) { break }
                            if (!this.#_records.get(record.scope)!.has(record.key)) { continue }
                            await kvEventsManager.emit.remove(record, { reason: 'memory.limit' });
                        }
                    }
                }

                this.#_queue.addTask(task);
            }
        },
        handle: {
            update: async (record: KVCacheRecord, newValue: unknown) => {
                if (!record.engines.includes('memory')) { return }
                const res = await engineProxy.read(record);
                const oldSize = this.#_memoryManager.helpers.getRecordSize(record.key, res.value);
                const newSize = this.#_memoryManager.helpers.getRecordSize(record.key, newValue);
                const delta = newSize - oldSize;
                await this.#_memoryManager.helpers.applyDelta(delta);
            },
            remove: async (record: KVCacheRecord) => {
                if (!record.engines.includes('memory')) { return }
                const res = await engineProxy.read(record);
                const size = this.#_memoryManager.helpers.getRecordSize(record.key, res.value);
                await this.#_memoryManager.helpers.applyDelta(-size);
            },
            create: async (record: KVCacheRecord) => {
                if (!record.engines.includes('memory')) { return }
                const res = await engineProxy.read(record);
                const size = this.#_memoryManager.helpers.getRecordSize(record.key, res.value);
                await this.#_memoryManager.helpers.applyDelta(size);
            }
        }
    }

    readonly #_helpers = {
        records: {
            getScopeMap: (scope: string) => {
                return helpers.records.getScopeMap(scope, this.#_records);
            }
        },
        cacheManagement: {
            idle: {
                createCleanHandler: () => {
                    return helpers.cacheManagement.idle.createCleanHandler(this.#_records, this.#_configs.idle, kvEventsManager);
                }
            },
            eviction: {
                scheduleEvictionCheck: atomix.utils.debounce(() => {
                    if (this.#_configs.eviction.enabled === false || this.#_queue.hasTask('eviction_check')) { return }
                    const task: BaseQueueTask = {
                        type: 'eviction_check',
                        action: async () => {
                            await helpers.cacheManagement.eviction.evictIfEnabled({
                                records: this.#_records,
                                policy: this.#_configs.eviction,
                                eventsManager: kvEventsManager,
                                getSize: () => this.size
                            });
                        }
                    }

                    this.#_queue.addTask(task);
                }, 100)
            }
        },
        checkIfClearing: (operation: 'get' | 'set' | 'touch' | 'remove' | 'read' | 'has', key: string) => {
            if (this.#_flags.blocking.clearing) { throw new Error(`Cannot ${operation} (${key}) while clearing`) }
        },
        createRemovePromise: async (key: string, scope: string = 'global'): Promise<boolean> => {
            const scopeMap = this.#_helpers.records.getScopeMap(scope);
            const record = scopeMap.get(key);
            if (!record) { return false }

            await kvEventsManager.emit.remove(record, { reason: 'manual' });
            return true;
        },
        startBlockingProcess: (process: BlockingProcess) => {
            for (const [key, value] of Object.entries(this.#_flags.blocking)) {
                if (value && key !== process) {
                    throw new Error(`Cannot start ${process} while ${key}`);
                }
            }
            this.#_flags.blocking[process] = true;
        }
    }

    readonly #_stats = {
        sizeInMemory: 0,
        counts: {
            read: 0,
            update: 0,
            touch: 0
        }
    }

    /**
     * Sets a key-value pair in the cache with an optional TTL.
     * If the key already exists, its value and TTL are updated.
     * If the key does not exist and the cache has reached its limit,
     * the least recently used record is removed.
     * 
     * @param {string} key The key to set in the cache.
     * @param {any} value The value to associate with the given key.
     * @param {KVSetOptions} [options] The options to use for setting the key-value pair.
     * The following options are available:
     * - `scope`: The scope of the record to set. Defaults to 'global'.
     * - `preload`: Whether or not to preload the record when it is created. Defaults to false.
     * - `ttl`: The time-to-live (TTL) settings for the record. Defaults to the cache's default TTL settings.
     * The `ttl` option can be a number (the TTL in milliseconds) or an object with the following properties:
     *   - `value`: The TTL in milliseconds.
     *   - `onExpire`: The function to call when the record expires.
     *     The function will be called with the record as its argument.
     * @since v1.0.0
     */
    async set<T>(key: string, value: T, options?: KVSetOptions): Promise<void> {
        this.#_helpers.checkIfClearing('set', key);

        try {
            const configs: KVSetConfigs = kvHelpers.validate.setOptions(this.#_configs, options);
            this.#_helpers.cacheManagement.eviction.scheduleEvictionCheck().catch(err => {
                if (err?.message !== 'Debounced function cancelled') { throw err }
            });
            const scopeMap = this.#_helpers.records.getScopeMap(configs.scope!);

            if (scopeMap.has(key)) {
                const record = scopeMap.get(key)!;
                this.#_memoryManager.handle.update(record, value);
                return record.update(value);
            }

            if (configs.storeIn.length === 0) { configs.storeIn.push('memory') }
            const record = new KVCacheRecord(key, configs);

            scopeMap.set(key, record);

            await record._init(value, configs.preload);
        } catch (error) {
            if (error instanceof TypeError) {
                error.message = `Unable to create a (key:value) pair record: ${error.message}`
            }

            throw error;
        }
    }

    /**
     * Retrieves the value associated with the given key from the cache within the specified scope.
     * If the key is not found, the method returns undefined.
     * Emits a 'read' event with the reason 'hit' upon successful retrieval.
     * 
     * @param {string} key - The key of the record to be retrieved.
     * @param {string} [scope='global'] - The scope from which to retrieve the record.
     * @returns {Promise<unknown>} The value associated with the given key, or undefined if no record exists.
     * @since v1.0.0
     */
    async get(key: string, scope: string = 'global'): Promise<unknown> {
        this.#_helpers.checkIfClearing('get', key);

        const scopeMap = this.#_helpers.records.getScopeMap(scope);
        const record = scopeMap.get(key);
        if (!record) { return undefined }

        const value = await record.read();
        await kvEventsManager.emit.read(record); // Emit the 'read' event
        return value
    }

    /**
     * Removes a key-value pair from the cache within the specified scope.
     * Emits a 'remove' event with the reason 'manual' upon successful removal.
     * 
     * @param {string} key - The key of the record to be removed.
     * @param {string} [scope='global'] - The scope from which to remove the record.
     * @returns {boolean} True if the record was found and removed, false otherwise.
     * @since v1.0.0
     */
    async remove(key: string, scope: string = 'global'): Promise<boolean> {
        this.#_helpers.checkIfClearing('remove', key);
        return this.#_helpers.createRemovePromise(key, scope);
    }

    /**
     * Checks if a key exists within the specified scope in the cache.
     *
     * @param {string} key - The key to check for existence.
     * @param {string} [scope='global'] - The scope in which to check for the key.
     * @returns {boolean} True if the key exists in the specified scope, false otherwise.
     * @since v1.0.0
     */
    has(key: string, scope: string = 'global'): boolean {
        this.#_helpers.checkIfClearing('has', key);
        const scopeMap = this.#_helpers.records.getScopeMap(scope);
        return scopeMap.has(key);
    }

    /**
     * Retrieves the total number of records stored in the cache across all scopes.
     * @returns {number} The total number of records in the cache.
     * @since v1.0.0
     */
    get size(): number {
        let size = 0;
        this.#_records.forEach(scopeMap => size += scopeMap.size);
        return size
    }

    /**
     * Retrieves the statistics counts for cache operations.
     * The statistics include the counts of read, update, and touch events.
     * @returns An object containing the counts of read, update, and touch events.
     * @since v1.0.0
     */
    get stats() {
        const cloned = atomix.dataTypes.object.smartClone(this.#_stats);
        return atomix.dataTypes.record.deepFreeze(cloned);
    }

    /**
     * Retrieves the configuration object for the cache.
     * This object contains the configuration for the time-to-live (TTL) and least-recently-used (LRU) policies.
     * @returns The configuration object for the cache.
     * @since v1.0.0
     */
    get configs() { return this.#_configs }

    /**
     * Clears the cache for the specified scope or for all scopes if no scope is provided.
     * Emits a 'clear' event for each record before removing it.
     * 
     * @param {string} [scope] - The scope for which to clear the cache. If not provided, clears all scopes.
     * @throws {TypeError} If the provided scope is not a string.
     * @throws {RangeError} If the provided scope is an empty string.
     * @since v1.0.0
     */
    async clear(scope?: string) {
        if (this.#_flags.blocking.clearing) { return }

        try {
            this.#_helpers.startBlockingProcess('clearing');

            const records = (() => {
                if (scope !== undefined) {
                    if (!atomix.valueIs.string(scope)) { throw new TypeError(`The provided scope (${scope}) is not a string.`) }
                    if (!atomix.valueIs.notEmptyString(scope)) { throw new RangeError(`The provided scope (${scope}) cannot be empty.`) }

                    const scopeMap = this.#_helpers.records.getScopeMap(scope);
                    const mainMap = new Map() as KVMainRecords;
                    mainMap.set(scope, scopeMap);
                    return mainMap
                } else {
                    return this.#_records;
                }
            })();

            const queue = new TasksQueue({ autoRun: true, concurrencyLimit: 1000 });

            for (const [_, scopeMap] of records) {
                for (const [_, record] of scopeMap) {
                    this.#_stats.counts.read -= record.stats.counts.read;
                    this.#_stats.counts.touch -= record.stats.counts.touch;
                    this.#_stats.counts.update -= record.stats.counts.update;

                    const task: BaseQueueTask = {
                        id: `${record.scope}:${record.key}`,
                        type: 'remove',
                        action: async () => await this.#_helpers.createRemovePromise(record.key, record.scope),
                        onReject: (error) => console.error(error),
                    }

                    queue.addTask(task);
                }
            }

            await queue.untilComplete();
            if (this.size === 0) {
                (this.#_helpers.cacheManagement.eviction.scheduleEvictionCheck as any).cancel();
                kvEventsManager.dispose();
            }
        } catch (err) {
            if (err instanceof Error) { err.message = `Unable to clear the ${this}: ${err.message}` }
            throw err;
        } finally {
            this.#_flags.blocking.clearing = false;
        }
    }


    /**
     * Exports all cached records to the specified persistent storage service.
     *
     * This method performs a full backup of the current cache. If a backup
     * operation is already in progress, this call is skipped silently.
     *
     * @template S - The target storage service type.
     * @param to - The identifier of the storage service to back up to.
     * @param args - Additional arguments to pass to the storage service's `backup` method.
     * @returns A promise that resolves once the backup completes.
     *
     * @throws If the target storage service is unsupported or not implemented.
     * @example
     * // Dump to an S3 bucket
     * await cachify.kv.backup('s3', 'backups/data-2025-07-27');
     * 
     * @example
     * await cachify.kv.backup('local', './backup/records-2025-07-27');
     * @since v1.0.0
     */
    async backup<S extends StorageServices>(to: S, ...args: BackupParameters<S>): Promise<void> {
        if (this.#_flags.blocking.backingUp) { return }

        try {
            this.#_helpers.startBlockingProcess('backingUp');
            await persistenceProxy.backup({ source: 'kv', content: this.#_records }, to, ...args);
        } catch (error) {
            if (error instanceof Error) { error.message = `Failed to backup ${this} to ${to}: ${error.message}` }
            throw error;
        } finally {
            this.#_flags.blocking.backingUp = false;
        }
    }

    /**
     * Restores records from a specified persistent storage service.
     *
     * This method performs a full restore of the cache from the specified storage service.
     * If a restore operation is already in progress, this call is skipped silently.
     *
     * @template S - The target storage service type.
     * @param from - The identifier of the storage service to restore from.
     * @param args - Additional arguments to pass to the storage service's `restore` method.
     * @returns A promise that resolves once the restore completes.
     *
     * @throws If the target storage service is unsupported or not implemented.
     * @example
     * // Restore from an S3 bucket
     * await cachify.kv.restore('s3', 'backups/data-2025-07-27');
     * 
     * @example
     * await cachify.kv.restore('local', './backup/records-2025-07-27');
     * @since v1.0.0
     */
    async restore<S extends StorageServices>(from: S, ...args: RestoreParameters<S>): Promise<void> {
        if (this.#_flags.blocking.restoring) { return }

        try {
            this.#_helpers.startBlockingProcess('restoring');
            await persistenceProxy.restore('kv', from, ...args);
        } catch (error) {
            if (error instanceof Error) { error.message = `Failed to restore ${this} from ${from}: ${error.message}` }
            throw error;
        } finally {
            this.#_flags.blocking.restoring = false;
        }
    }

    /**
     * Returns a string representation of the object.
     *
     * @returns {string} The string representation of the object.
     * @since v1.0.0
     */
    toString(): string { return 'KVCacheManager' }
}

export default KVCacheManager;
type KVMainRecords = Map<string, Map<string, KVCacheRecord>>;