import atomix from "@nasriya/atomix";
import cron, { ScheduledTask } from "@nasriya/cron";

import KVCacheRecord from "./kvs.record";
import KVsCacheConfig from "../../configs/managers/kvs/KVsCacheConfig";
import KVsEventsManager from "../../events/managers/kvs/KVsEventsManager";
import helpers from "../helpers";
import constants from "../../consts/consts";
import utils from "../../../utils/utils";

import EnginesProxy from "../../engines/EnginesProxy";
import PersistenceProxy from "../../persistence/proxy";
import SessionsController from "../../sessions/SessionsController";
import CacheSession from "../../sessions/CacheSession";
import type { BaseQueueTask } from "@nasriya/atomix/tools";
import type { CacheStatusChangeHandler, TTLKVOptions } from "../../configs/strategies/docs";
import type { BackupParameters, RestoreParameters, StorageServices } from "../../persistence/docs";
import type { BlockingFlags, BlockingProcess, CacheManagerAssets, CachePreloadInitiator } from "../../docs/docs";
import type { KVSetOptions, KVSetConfigs, KVNormalSetConfigs, KVNormalSetOptions, KVPreloadWarmupSetOptions, KVPreloadWarmupSetConfigs, KVPreloadRestoreSetOptions, KVPreloadRestoreSetConfigs, KVPreloadSetConfigs, KVCacheController } from "./docs";
import type { SessionOptions } from "../../sessions/docs";

const hasOwnProp = atomix.dataTypes.record.hasOwnProperty;

class KVsCacheManager {
    readonly #_records: KVMainRecords = new Map();
    readonly #_defaultEngines = ['memory'];
    readonly #_enginesProxy: EnginesProxy;
    readonly #_persistenceProxy: PersistenceProxy;
    readonly #_events: KVsEventsManager;
    readonly #_configs: KVsCacheConfig;
    readonly #_queue = new atomix.tools.TasksQueue({ autoRun: true });
    readonly #_jobs = { clearIdleItems: undefined as unknown as ScheduledTask }
    readonly #_sessions: SessionsController;

    readonly #_flags = {
        blocking: { clearing: false, backingUp: false, restoring: false } as BlockingFlags
    }

    constructor(assets: CacheManagerAssets<'kvs'>) {
        this.#_enginesProxy = assets.enginesProxy;
        this.#_persistenceProxy = assets.persistenceProxy;
        this.#_events = assets.eventsManager;

        this.#_sessions = new SessionsController(this.#_controller);

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

            this.#_configs = new KVsCacheConfig(onCacheStatusChange);
        }

        // Prepare the scheduled task to clean up idle items
        {
            this.#_jobs.clearIdleItems = cron.schedule(
                cron.time.every(5).minutes(),
                this.#_helpers.cacheManagement.idle.createCleanHandler(),
                {
                    runOnInit: false,
                    name: `kvs_clean_idle_items_${atomix.utils.generateRandom(8)}`
                }
            )
        }

        // Listen on events to update stats
        {
            this.#_events.on('remove', async event => {
                const scopeMap = this.#_helpers.records.getScopeMap(event.item.scope);
                const record = scopeMap.get(event.item.key);
                if (record) {
                    this.#_memoryManager.handle.remove(record);
                    await this.#_enginesProxy.remove(record);
                }

                scopeMap.delete(event.item.key);
            }, { type: 'beforeAll' });

            this.#_events.on('bulkRemove', async event => {
                for (const item of event.items) {
                    const scopeMap = this.#_helpers.records.getScopeMap(item.scope);
                    const record = scopeMap.get(item.key);
                    if (record) {
                        this.#_memoryManager.handle.remove(record);
                        await this.#_enginesProxy.remove(record);
                    }

                    scopeMap.delete(item.key);
                }
            }, { type: 'beforeAll' });

            this.#_events.on('update', event => {
                this.#_stats.counts.update++;
            }, { type: 'beforeAll' });

            this.#_events.on('read', event => {
                this.#_stats.counts.read++;
            }, { type: 'beforeAll' });

            this.#_events.on('touch', event => {
                this.#_stats.counts.touch++;
            }, { type: 'beforeAll' });

            this.#_events.on('create', event => {
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
                            await this.#_events.emit.remove(record, { reason: 'memory.limit' });
                        }
                    }
                }

                this.#_queue.addTask(task);
            }
        },
        handle: {
            update: async (record: KVCacheRecord, newValue: unknown) => {
                if (!record.engines.includes('memory')) { return }
                const res = await this.#_enginesProxy.read(record);
                const oldSize = this.#_memoryManager.helpers.getRecordSize(record.key, res.value);
                const newSize = this.#_memoryManager.helpers.getRecordSize(record.key, newValue);
                const delta = newSize - oldSize;
                await this.#_memoryManager.helpers.applyDelta(delta);
            },
            remove: async (record: KVCacheRecord) => {
                if (!record.engines.includes('memory')) { return }
                await this.#_memoryManager.helpers.applyDelta(-record.stats.size);
            },
            create: async (record: KVCacheRecord) => {
                if (!record.engines.includes('memory')) { return }
                const res = await this.#_enginesProxy.read(record);
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
                    return helpers.cacheManagement.idle.createCleanHandler(this.#_records, this.#_configs.idle, this.#_events);
                }
            },
            eviction: {
                scheduleEvictionCheck: atomix.utils.debounce(() => {
                    if (this.#_configs.eviction.enabled === false || this.#_queue.hasTask('eviction_check')) { return }
                    const task: BaseQueueTask = {
                        id: 'eviction_check',
                        type: 'eviction_check',
                        action: async () => {
                            await helpers.cacheManagement.eviction.evictIfEnabled({
                                records: this.#_records,
                                policy: this.#_configs.eviction,
                                eventsManager: this.#_events,
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
        startBlockingProcess: (process: BlockingProcess) => {
            for (const [key, value] of Object.entries(this.#_flags.blocking)) {
                if (value && key !== process) {
                    throw new Error(`Cannot start ${process} while ${key}`);
                }
            }
            this.#_flags.blocking[process] = true;
        },
        setMethod: {
            defaultConfigs: (cacheConfig: KVsCacheConfig) => {
                const configs: KVNormalSetConfigs = {
                    preload: false,
                    scope: 'global',
                    storeIn: [],
                    ttl: {
                        value: cacheConfig.ttl.enabled ? cacheConfig.ttl.value : 0,
                        onExpire: cacheConfig.ttl.onExpire,
                        sliding: cacheConfig.ttl.sliding
                    }
                }

                return atomix.dataTypes.object.smartClone(configs);
            },
            validate: {
                miniHelpers: {
                    normalOptions: (options: KVNormalSetOptions) => {
                        const configs = this.#_helpers.setMethod.defaultConfigs(this.#_configs);

                        if (hasOwnProp(options, 'scope')) {
                            if (!atomix.valueIs.string(options.scope)) { throw new TypeError(`The "scope" property of the "options" object (when provided) must be a string, but instead got ${typeof options.scope}`) }
                            if (options.scope.length === 0) { throw new RangeError(`The "scope" property of the "options" object (when provided) must be a non-empty string`) }
                            configs.scope = options.scope;
                        }

                        if (hasOwnProp(options, 'ttl')) {
                            const ttl = options.ttl;
                            const isRecord = atomix.valueIs.record(ttl);
                            const isNumber = atomix.valueIs.number(ttl);

                            if (!(isNumber || isRecord)) { throw new TypeError(`The "ttl" property of the "options" object (when provided) must be a number or a record, but instead got ${typeof ttl}`) }

                            if (isNumber) {
                                (configs.ttl as TTLKVOptions).value = ttl;
                            }

                            if (isRecord) {
                                if (hasOwnProp(ttl, 'value')) {
                                    if (!atomix.valueIs.number(ttl.value)) { throw new TypeError(`The "value" property of the "ttl" object (when provided) must be a number, but instead got ${typeof ttl.value}`) }
                                    if (!atomix.valueIs.integer(ttl.value)) { throw new TypeError(`The "value" property of the "ttl" object (when provided) must be an integer, but instead got ${ttl.value}`) }
                                    (configs.ttl as TTLKVOptions).value = ttl.value;
                                }

                                if (hasOwnProp(ttl, 'sliding')) {
                                    if (typeof ttl.sliding !== 'boolean') { throw new TypeError(`The "sliding" property of the "ttl" object (when provided) must be a boolean, but instead got ${typeof ttl.sliding}`) }
                                    (configs.ttl as TTLKVOptions).sliding = ttl.sliding;
                                }

                                if (hasOwnProp(ttl, 'onExpire')) {
                                    if (typeof ttl.onExpire !== 'function') { throw new TypeError(`The "onExpire" property of the "ttl" object (when provided) must be a function, but instead got ${typeof ttl.onExpire}`) }
                                    (configs.ttl as TTLKVOptions).onExpire = ttl.onExpire;
                                }
                            }
                        }

                        if (hasOwnProp(options, 'storeIn')) {
                            const isString = atomix.valueIs.string(options.storeIn);
                            const isArray = atomix.valueIs.array(options.storeIn);

                            if (!(isString || isArray)) {
                                throw new TypeError(`The "storeIn" property of the "options" object (when provided) must be a string or an array of strings, but instead got ${typeof options.storeIn}`);
                            }

                            const enginesInput: string[] = [];
                            if (isString) {
                                enginesInput.push(options.storeIn as string)
                            } else {
                                enginesInput.push(...(options.storeIn as string[]));
                            }

                            for (const engine of enginesInput) {
                                if (!atomix.valueIs.string(engine)) { throw new TypeError(`The "storeIn" property of the "options" object (when provided) must be a string or an array of strings, but instead got ${typeof engine}`) }
                                if (engine.length === 0) { throw new RangeError(`The "storeIn" property of the "options" object (when provided) must be a non-empty string or an array of non-empty strings`) }
                                if (!this.#_enginesProxy.engines.hasEngine(engine)) {
                                    throw new Error(`The "storeIn" property of the "options" object (when provided) must be a string or an array of strings, but the engine "${engine}" is not defined.`);
                                }
                            }

                            configs.storeIn = enginesInput;
                        }

                        return configs;
                    },

                    preloadOptions: {
                        warmup: (options: KVPreloadWarmupSetOptions, normalConfigs: KVNormalSetConfigs): KVPreloadWarmupSetConfigs => {
                            const { preload: _, ...rest } = normalConfigs;
                            const configs: KVPreloadWarmupSetConfigs = {
                                initiator: 'warmup',
                                preload: true,
                                ...rest,
                            }

                            return configs;
                        },

                        restore: (options: KVPreloadRestoreSetOptions, normalConfigs: KVNormalSetConfigs): KVPreloadRestoreSetConfigs => {
                            const { preload: _, ...rest } = normalConfigs;
                            for (const key in rest) {
                                if (!hasOwnProp(rest, key)) { throw new SyntaxError(`The preload restore options object must have a "${key}" property`) }
                            }

                            const configs: KVPreloadRestoreSetConfigs = {
                                initiator: 'restore',
                                preload: true,
                                ...rest,
                                stats: {
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
                            }

                            const assertPositiveInteger = utils.assert.type.positiveInteger;

                            if (hasOwnProp(options, 'stats')) {
                                if (!atomix.valueIs.record(options.stats)) { throw new TypeError(`The "stats" property of the "options" object (when provided) must be an object, but instead got ${typeof options.stats}`) }

                                if (hasOwnProp(options.stats, 'dates')) {
                                    const dates = options.stats.dates;
                                    if (!atomix.valueIs.record(dates)) { throw new TypeError(`The "dates" property of the "stats" object (when provided) must be an object, but instead got ${typeof dates}`) }

                                    if (hasOwnProp(dates, 'created')) {
                                        assertPositiveInteger(dates.created, 'created', 'stats.dates');
                                        configs.stats.dates.created = dates.created;
                                    } else {
                                        throw new SyntaxError(`The "created" property of the "dates" property of the "stats" object (when provided) is required when "preload" is true`);
                                    }

                                    if (hasOwnProp(dates, 'lastAccess')) {
                                        if (dates.lastAccess !== undefined) { assertPositiveInteger(dates.lastAccess, 'lastAccess', 'stats.dates') }
                                        configs.stats.dates.lastAccess = dates.lastAccess;
                                    }

                                    if (hasOwnProp(dates, 'lastUpdate')) {
                                        if (dates.lastUpdate !== undefined) { assertPositiveInteger(dates.lastUpdate, 'lastUpdate', 'stats.dates') }
                                        configs.stats.dates.lastUpdate = dates.lastUpdate;
                                    }

                                    if (hasOwnProp(dates, 'expireAt')) {
                                        if (dates.expireAt !== undefined) { assertPositiveInteger(dates.expireAt, 'expireAt', 'stats.dates') }
                                        configs.stats.dates.expireAt = dates.expireAt;
                                    }
                                } else {
                                    throw new SyntaxError(`The "dates" property of the "stats" object (when provided) is required when "preload" is true`)
                                }

                                if (hasOwnProp(options.stats, 'counts')) {
                                    const counts = options.stats.counts;
                                    if (!atomix.valueIs.record(counts)) { throw new TypeError(`The "counts" property of the "stats" object (when provided) must be an object, but instead got ${typeof counts}`) }

                                    if (hasOwnProp(counts, 'read')) {
                                        assertPositiveInteger(counts.read, 'read', 'stats.counts');
                                        configs.stats.counts.read = counts.read;
                                    } else {
                                        throw new SyntaxError(`The "read" property of the "counts" property of the "stats" object (when provided) is required when "preload" is true`);
                                    }

                                    if (hasOwnProp(counts, 'update')) {
                                        assertPositiveInteger(counts.update, 'update', 'stats.counts');
                                        configs.stats.counts.update = counts.update;
                                    } else {
                                        throw new SyntaxError(`The "update" property of the "counts" property of the "stats" object (when provided) is required when "preload" is true`);
                                    }

                                    if (hasOwnProp(counts, 'touch')) {
                                        assertPositiveInteger(counts.touch, 'touch', 'stats.counts');
                                        configs.stats.counts.touch = counts.touch;
                                    } else {
                                        throw new SyntaxError(`The "touch" property of the "counts" property of the "stats" object (when provided) is required when "preload" is true`);
                                    }

                                    if (hasOwnProp(counts, 'hit')) {
                                        assertPositiveInteger(counts.hit, 'hit', 'stats.counts');
                                        configs.stats.counts.hit = counts.hit;
                                    } else {
                                        throw new SyntaxError(`The "hit" property of the "counts" property of the "stats" object (when provided) is required when "preload" is true`);
                                    }

                                    if (hasOwnProp(counts, 'miss')) {
                                        assertPositiveInteger(counts.miss, 'miss', 'stats.counts');
                                        configs.stats.counts.miss = counts.miss;
                                    } else {
                                        throw new SyntaxError(`The "miss" property of the "counts" property of the "stats" object (when provided) is required when "preload" is true`);
                                    }
                                } else {
                                    throw new SyntaxError(`The "counts" property of the "stats" object (when provided) is required when "preload" is true`)
                                }
                            } else {
                                throw new SyntaxError(`The "stats" property of the "options" object (when provided) must be an object, but instead got ${typeof options.stats}`)
                            }

                            return configs;
                        },

                        any: (options: KVPreloadSetConfigs, normalConfigs: KVNormalSetConfigs) => {
                            const { preload: _, ttl, ...rest } = normalConfigs;

                            const initiator = options.initiator;
                            switch (initiator) {
                                case 'restore':
                                    return this.#_helpers.setMethod.validate.miniHelpers.preloadOptions.restore(options, normalConfigs);

                                case 'warmup':
                                    return this.#_helpers.setMethod.validate.miniHelpers.preloadOptions.warmup(options, normalConfigs);

                                default:
                                    throw new SyntaxError(`The "initiator" property of the "options" object (when provided) must be either ${constants.CACHE_PRELOAD_INITIATORS.map(i => `"${i}"`).join(', ')} when "preload" is true, but instead got "${initiator}"`);
                            }
                        }
                    }
                },
                options: (options?: KVSetOptions) => {
                    if (options === undefined) { return this.#_helpers.setMethod.defaultConfigs(this.#_configs); }

                    if (!atomix.valueIs.record(options)) { throw new TypeError(`The "options" parameter (when provided) must be an object, but instead got ${typeof options}`) }

                    let preload = false;
                    if (hasOwnProp(options, 'preload')) {
                        if (typeof options.preload !== 'boolean') { throw new TypeError(`The "preload" property of the "options" object (when provided) must be a boolean, but instead got ${typeof options.preload}`) }
                        preload = options.preload;

                        if (options.preload) {
                            if (hasOwnProp(options, 'initiator')) {
                                const initiator = options.initiator;
                                if (!atomix.valueIs.string(initiator)) { throw new TypeError(`The "initiator" property of the "options" object (when provided) must be a string, but instead got ${typeof initiator}`) }
                                if (!constants.CACHE_PRELOAD_INITIATORS.includes(initiator as CachePreloadInitiator)) { throw new RangeError(`The "initiator" property of the "options" object (when provided) must be one of the following values: ${constants.CACHE_PRELOAD_INITIATORS.join(', ')}, but instead got "${initiator}".`) }
                            } else {
                                throw new SyntaxError(`The "initiator" property of the "options" object (when provided) is required when "preload" is true`);
                            }
                        }
                    }

                    const validate = this.#_helpers.setMethod.validate

                    const normalConfigs = validate.miniHelpers.normalOptions(options as KVNormalSetConfigs);
                    return preload ? validate.miniHelpers.preloadOptions.any(options as unknown as KVPreloadSetConfigs, normalConfigs) : normalConfigs;
                }
            }
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

    readonly #_controller: KVCacheController = {
        get: (key: string, scope: string): KVCacheRecord | undefined => {
            const scopeMap = this.#_helpers.records.getScopeMap(scope);
            return scopeMap.get(key);
        },
        update: async (record: KVCacheRecord, value: unknown, session?: CacheSession): Promise<void> => {
            if (record.locked) {
                if (!session || !session.lockedRecords.has(record)) {
                    await record.untilReleased();
                }
            }

            this.#_memoryManager.handle.update(record, value);
            return record.update(value);
        },
        set: async (key: string, value: unknown, options?: KVSetOptions, session?: CacheSession): Promise<void> => {
            try {
                const configs: KVSetConfigs = this.#_helpers.setMethod.validate.options(options);
                this.#_helpers.cacheManagement.eviction.scheduleEvictionCheck().catch(err => {
                    if (err?.message !== 'Debounced function cancelled') { throw err }
                });
                const scopeMap = this.#_helpers.records.getScopeMap(configs.scope!);

                if (scopeMap.has(key)) {
                    const record = scopeMap.get(key)!;
                    await this.#_controller.update(record, value, session);
                }

                if (configs.storeIn.length === 0) { configs.storeIn.push(...this.#_defaultEngines) }
                const record = new KVCacheRecord(key, configs, this.#_enginesProxy, this.#_events);

                scopeMap.set(key, record);

                await record._init(value, configs.preload);
            } catch (error) {
                if (error instanceof TypeError) {
                    error.message = `Unable to create a (key:value) pair record: ${error.message}`
                }

                throw error;
            }
        },
        read: async <T = unknown>(key: string, scope: string = 'global', session?: CacheSession): Promise<T | undefined> => {
            const scopeMap = this.#_helpers.records.getScopeMap(scope);
            const record = scopeMap.get(key);
            if (!record) { return undefined }

            const handleLocked = async (record: KVCacheRecord, session?: CacheSession) => {
                if (session && session.lockedRecords.has(record)) {
                    const policy = session.policy;
                    if (policy.blockRead === false) {
                        return;
                    }
                }

                return record.untilReleased();
            }

            if (record.locked) {
                await handleLocked(record, session);
            }

            const value = await record.read<T>();
            await this.#_events.emit.read(record); // Emit the 'read' event
            return value
        },
        remove: async (key: string, scope: string = 'global', session?: CacheSession): Promise<boolean> => {
            const scopeMap = this.#_helpers.records.getScopeMap(scope);
            const record = scopeMap.get(key);
            if (!record) { return false }

            if (record.locked) {
                if (!session || !session.lockedRecords.has(record)) {
                    await record.untilReleased();
                }
            }

            await this.#_events.emit.remove(record, { reason: 'manual' });
            return true;
        }
    }

    /**
     * Sets the default engines to use when no engines are provided to a {@link set} method.
     * 
     * - If no engines are provided, the default engines are used.
     * - If the engines argument is undefined, the default engines are reset to include only the `'memory'` engine.
     * - If the engines argument is an empty array, a RangeError is thrown.
     * - If the engines argument contains any engines that do not exist, a RangeError is thrown.
     * 
     * @param {string | string[] | undefined} engines The engines to set as the default engines.
     * @since v1.0.0
     */
    set defaultEngines(engines: string | string[] | undefined) {
        if (engines === undefined) {
            this.#_defaultEngines.length = 0;
            this.#_defaultEngines.push('memory');
            return;
        }

        const defaults = atomix.valueIs.arrayOfStrings(engines) ? engines : atomix.valueIs.string(engines) ? [engines] : undefined;
        if (defaults === undefined) { throw new TypeError(`The "engines" parameter (when provided) must be a string or an array of strings, but instead got ${typeof engines}`) }
        if (defaults.length === 0) { throw new RangeError(`The "engines" parameter (when provided) must contain at least one engine, but instead got an empty array`) }

        for (const engine of defaults) {
            if (!this.#_enginesProxy.engines.hasEngine(engine)) { throw new RangeError(`The "engines" parameter (when provided) must contain only existing engines, but instead got "${engine}"`) }
        }

        this.#_defaultEngines.length = 0;
        this.#_defaultEngines.push(...defaults);
    }

    /**
     * @returns The list of default engines.
     * @since v1.0.0
     */
    get defaultEngines(): string[] {
        return this.#_defaultEngines;
    }

    /**
     * Creates a new lock session.
     * 
     * A lock session is a lightweight object that can be used to synchronize cache operations.
     * Lock sessions are reentrant, meaning that if a lock session is already locked, any subsequent
     * calls to lock the session will not block, and instead simply increment the lock count.
     * 
     * @returns A new lock session.
     * @since v1.0.0
     */
    createLockSession(options?: SessionOptions): CacheSession {
        return this.#_sessions.createSession(options);
    }

    /**
     * Retrieves a record from the cache by its key.
     * 
     * @param key - The key of the record to retrieve.
     * @param scope - The scope of the record to retrieve. Defaults to 'global'.
     * @returns The record associated with the given key if it exists, otherwise undefined.
     * @since v1.0.0
     */
    inpect(key: string, scope: string = 'global') {
        const scopeMap = this.#_helpers.records.getScopeMap(scope);
        const record = scopeMap.get(key);
        if (!record) { return undefined }
        return record.toJSON()
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
    async set(key: string, value: unknown, options?: KVSetOptions): Promise<void> {
        this.#_helpers.checkIfClearing('set', key);
        this.#_controller.set(key, value, options);
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
    async read<T = unknown>(key: string, scope: string = 'global'): Promise<T | undefined> {
        this.#_helpers.checkIfClearing('get', key);
        return this.#_controller.read<T>(key, scope);
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
        return this.#_controller.remove(key, scope);
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

            const recordsMap = (() => {
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

            const iterator = helpers.records.createIterator(recordsMap);
            const records: KVCacheRecord[] = [];
            const stats = Object.seal({ read: 0, update: 0, touch: 0 });

            const remove = async () => {
                if (records.length === 0) { return }
                await this.#_events.emit.bulkRemove(records, { reason: 'manual' });

                this.#_stats.counts.read -= stats.read;
                this.#_stats.counts.update -= stats.update;
                this.#_stats.counts.touch -= stats.touch;

                records.length = stats.read = stats.update = stats.touch = 0;
            }

            for (const { record } of iterator) {
                stats.read += record.stats.counts.read;
                stats.update += record.stats.counts.update;
                stats.touch += record.stats.counts.touch;

                records.push(record as KVCacheRecord);
                if (records.length === 1_000) {
                    await remove();
                }
            }

            await remove();
            if (this.size === 0) {
                (this.#_helpers.cacheManagement.eviction.scheduleEvictionCheck as any).cancel();
                this.#_events.dispose();
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
     * await cachify.kvs.backup('s3', 'backups/data-2025-07-27');
     * 
     * @example
     * await cachify.kvs.backup('local', './backup/records-2025-07-27');
     * @since v1.0.0
     */
    async backup<S extends StorageServices>(to: S, ...args: BackupParameters<S>): Promise<void> {
        if (this.#_flags.blocking.backingUp) { return }

        try {
            this.#_helpers.startBlockingProcess('backingUp');
            await this.#_persistenceProxy.backup({ source: 'kvs', content: this.#_records }, to, ...args);
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
     * await cachify.kvs.restore('s3', 'backups/data-2025-07-27');
     * 
     * @example
     * await cachify.kvs.restore('local', './backup/records-2025-07-27');
     * @since v1.0.0
     */
    async restore<S extends StorageServices>(from: S, ...args: RestoreParameters<S>): Promise<void> {
        if (this.#_flags.blocking.restoring) { return }

        try {
            this.#_helpers.startBlockingProcess('restoring');
            await this.#_persistenceProxy.restore('kvs', from, ...args);
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
    toString(): string { return 'KVsCacheManager' }
}

export default KVsCacheManager;
export type KVMainRecords = Map<string, Map<string, KVCacheRecord>>;