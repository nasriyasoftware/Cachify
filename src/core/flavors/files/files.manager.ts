import atomix from "@nasriya/atomix";
import cron, { ScheduledTask } from "@nasriya/cron";

import FileCacheRecord from "./files.record";
import FilesCacheConfig from "../../configs/managers/files/FilesCacheConfig";
import FilesEventsManager from "../../events/managers/files/FilesEventsManager";
import helpers from "../helpers";

import type { CacheStatusChangeHandler, TTLFileOptions } from "../../configs/strategies/docs";
import type { FileContentSizeChangeEvent } from "../../events/docs";
import type { BaseQueueTask } from "@nasriya/atomix/tools";

import EnginesProxy from "../../engines/EnginesProxy";
import PersistenceProxy from "../../persistence/proxy";
import utils from "../../../utils/utils";
import constants from "../../consts/consts";
import type { BlockingFlags, BlockingProcess, CacheFlavor, CacheManagerAssets, CachePreloadInitiator } from "../../docs/docs";
import type { BackupParameters, RestoreParameters, StorageServices } from "../../persistence/docs";
import type { FileKeyOptions, FileNormalSetConfigs, FileNormalSetOptions, FileOptions, FilePathOptions, FilePreloadRestoreSetConfigs, FilePreloadRestoreSetOptions, FilePreloadSetConfigs, FilePreloadSetOptions, FilePreloadWarmupSetConfigs, FilePreloadWarmupSetOptions, FileSetConfigs, FileSetOptions } from "./docs";

const hasOwnProp = atomix.dataTypes.record.hasOwnProperty;

class FilesCacheManager {
    readonly #_files: FilesMainRecord = new Map();
    readonly #_defaultEngines = ['memory'];
    readonly #_enginesProxy: EnginesProxy;
    readonly #_persistenceProxy: PersistenceProxy;
    readonly #_events: FilesEventsManager;
    readonly #_configs: FilesCacheConfig;

    readonly #_queue = new atomix.tools.TasksQueue({ autoRun: true });
    readonly #_jobs = { clearIdleItems: undefined as unknown as ScheduledTask }
    readonly #_flags = {
        blocking: { clearing: false, backingUp: false, restoring: false } as BlockingFlags
    }

    constructor(assets: CacheManagerAssets<'files'>) {
        this.#_enginesProxy = assets.enginesProxy;
        this.#_persistenceProxy = assets.persistenceProxy;
        this.#_events = assets.eventsManager;

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

            this.#_configs = new FilesCacheConfig(onCacheStatusChange);
        }

        // Prepare the scheduled task to clean up idle items
        {
            this.#_jobs.clearIdleItems = cron.schedule(
                cron.time.every(5).minutes(),
                this.#_helpers.cacheManagement.idle.createCleanHandler(),
                {
                    runOnInit: false,
                    name: `file_clean_idle_items_${atomix.utils.generateRandom(8)}`
                }
            )
        }

        // Listen on events to update stats
        {
            this.#_events.on('remove', async event => {
                if (event.flavor === 'files') {
                    const scopeMap = this.#_helpers.records.getScopeMap(event.item.scope);
                    const record = scopeMap.get(event.item.key)!;
                    if (record) {
                        await this.#_enginesProxy.remove(record);
                    }

                    scopeMap.delete(event.item.key);
                }
            }, { type: 'beforeAll' });

            this.#_events.on('bulkRemove', async event => {
                for (const item of event.items) {
                    const scopeMap = this.#_helpers.records.getScopeMap(item.scope);
                    const record = scopeMap.get(item.key);
                    if (record) {
                        await this.#_enginesProxy.remove(record);
                    }

                    scopeMap.delete(item.key);
                }
            }, { type: 'beforeAll' });

            this.#_events.on('read', event => {
                this.#_stats.counts.read++;
            }, { type: 'beforeAll' });

            this.#_events.on('update', event => {
                this.#_stats.counts.update++;
            }, { type: 'beforeAll' });

            this.#_events.on('touch', event => {
                this.#_stats.counts.touch++;
            }, { type: 'beforeAll' });

            this.#_events.on('hit', event => {
                this.#_stats.counts.hit++;
            }, { type: 'beforeAll' });

            this.#_events.on('miss', event => {
                this.#_stats.counts.miss++;
            }, { type: 'beforeAll' });

            this.#_events.on('fileContentSizeChange', event => {
                this.#_memoryManager.handle(event);
            }, { type: 'beforeAll' });

            this.#_events.on('fileRenameChange', event => {
                const scopeMap = this.#_helpers.records.getScopeMap(event.item.scope);
                const record = scopeMap.get(event.item.key);
                const newKey = this.#_helpers.generateKey(event.newPath);

                if (record) {
                    scopeMap.set(newKey, record);
                    scopeMap.delete(event.item.key);
                }
            }, { type: 'beforeAll' });
        }
    }

    readonly #_memoryManager = {
        data: {
            sortingHandler: (a: FileCacheRecord, b: FileCacheRecord): number => {
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
                        const allRecords: FileCacheRecord[] = [];
                        for (const [_, scopeMap] of this.#_files) {
                            allRecords.push(...Array.from(scopeMap.values()));
                        }

                        // Sort the records
                        allRecords.sort(this.#_memoryManager.data.sortingHandler);

                        // Attempting to free memory
                        for (const record of allRecords) {
                            if (sizeToFree() === 0) { break }
                            if (!this.#_files.get(record.scope)!.has(record.key)) { continue }
                            record.clearContent();
                        }
                    }
                }

                this.#_queue.addTask(task);
            }
        },
        handle: (event: FileContentSizeChangeEvent) => {
            if (!event.item.engines.includes('memory')) { return }
            this.#_memoryManager.helpers.applyDelta(event.delta);
        }
    }

    readonly #_helpers = {
        records: {
            getScopeMap: (scope: string) => {
                return helpers.records.getScopeMap(scope, this.#_files);
            },
            getRecord: (configs: InternalIOConfigs) => {
                const scopeMap = this.#_helpers.records.getScopeMap(configs.scope);
                if (configs.caseSensitive) {
                    return scopeMap.get(configs.key)
                } else {
                    const inputPath = configs.filePath.toLowerCase();
                    for (const record of scopeMap.values()) {
                        const recordPath = record.file.path;
                        if (recordPath.toLowerCase() === inputPath) {
                            return record;
                        }
                    }
                }
            }
        },
        cacheManagement: {
            idle: {
                createCleanHandler: (): () => Promise<void> => {
                    return helpers.cacheManagement.idle.createCleanHandler(this.#_files, this.#_configs.idle, this.#_events);
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
                                records: this.#_files,
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
        parseFileOptions: (options: FileOptions): InternalIOConfigs => {
            const configs = {
                scope: 'global',
                key: undefined as unknown as string,
            }

            const pathConfigs = {
                caseSensitive: true,
                filePath: ''
            }

            if (!atomix.valueIs.record(options)) { throw new TypeError(`The "options" argument must be a record, but instead got ${typeof options}`) }
            const hasKey = hasOwnProp(options, 'key');
            const hasScope = hasOwnProp(options, 'scope');
            const hasFilePath = hasOwnProp(options, 'filePath');
            const hasCaseSensitive = hasOwnProp(options, 'caseSensitive');

            if (hasScope) {
                const scope = options.scope;
                if (!atomix.valueIs.string(scope)) { throw new TypeError(`The "scope" property of the "options" object (when provided) must be a string, but instead got ${typeof scope}`) }
                if (scope.length === 0) { throw new RangeError(`The "scope" property of the "options" object (when provided) must be a non-empty string`) }
                configs.scope = scope;
            }

            if (hasKey || hasFilePath) {
                if (hasKey) {
                    const key = (options as FileKeyOptions).key;
                    if (!atomix.valueIs.string(key)) { throw new TypeError(`The "key" property of the "options" object (when provided) must be a string, but instead got ${typeof key}`) }
                    if (key.length === 0) { throw new RangeError(`The "key" property of the "options" object (when provided) must be a non-empty string`) }
                    configs.key = key;
                } else {
                    const filePath = (options as FilePathOptions).filePath;
                    if (!atomix.valueIs.string(filePath)) { throw new TypeError(`The "filePath" property of the "options" object (when provided) must be a string, but instead got ${typeof filePath}`) }
                    if (filePath.length === 0) { throw new RangeError(`The "filePath" property of the "options" object (when provided) must be a non-empty string`) }
                    configs.key = this.#_helpers.generateKey(filePath);
                    pathConfigs.filePath = filePath;

                    if (hasCaseSensitive) {
                        const caseSensitive = (options as FilePathOptions).caseSensitive;
                        if (typeof caseSensitive !== 'boolean') { throw new TypeError(`The "caseSensitive" property of the "options" object (when provided) must be a boolean, but instead got ${typeof caseSensitive}`) }
                        pathConfigs.caseSensitive = caseSensitive;
                    }
                }
            } else {
                throw new SyntaxError(`The "options" object must have either a "key" or a "filePath" property.`);
            }

            return { ...configs, ...pathConfigs };
        },
        checkIfClearing: (operation: 'get' | 'set' | 'touch' | 'remove' | 'read' | 'has', key: string) => {
            if (this.#_flags.blocking.clearing) { throw new Error(`Cannot ${operation} (${key}) while clearing`) }
        },
        createRemovePromise: async (key: string, scope: string = 'global'): Promise<boolean> => {
            const scopeMap = this.#_helpers.records.getScopeMap(scope);
            const record = scopeMap.get(key);
            if (!record) { return false }

            await this.#_events.emit.remove(record, { reason: 'manual' });
            return true;
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
            defaultConfigs: (key: string, cacheConfig: FilesCacheConfig) => {
                const configs: FileSetConfigs = {
                    key: key,
                    scope: 'global',
                    storeIn: [],
                    preload: false,
                    ttl: {
                        value: cacheConfig.ttl.enabled ? cacheConfig.ttl.value : 0,
                        onExpire: cacheConfig.ttl.onExpire,
                        policy: cacheConfig.ttl.policy,
                        sliding: cacheConfig.ttl.sliding
                    }
                }

                return atomix.dataTypes.object.smartClone(configs);
            },
            validate: {
                miniHelpers: {
                    normalOptions: (key: string, options: FileNormalSetOptions, cacheConfigs: FilesCacheConfig) => {
                        const configs = this.#_helpers.setMethod.defaultConfigs(key, this.#_configs);

                        if (hasOwnProp(options, 'key')) {
                            if (!atomix.valueIs.string(options.key)) { throw new TypeError(`The "key" property of the "options" object (when provided) must be a string, but instead got ${typeof options.key}`) }
                            if (options.key.length === 0) { throw new RangeError(`The "key" property of the "options" object (when provided) must be a non-empty string`) }
                            configs.key = options.key;
                        }

                        if (hasOwnProp(options, 'scope')) {
                            if (!atomix.valueIs.string(options.scope)) { throw new TypeError(`The "scope" property of the "options" object (when provided) must be a string, but instead got ${typeof options.scope}`) }
                            if (options.scope.length === 0) { throw new RangeError(`The "scope" property of the "options" object (when provided) must be a non-empty string`) }
                            configs.scope = options.scope;
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

                        if (hasOwnProp(options, 'ttl')) {
                            const ttl = options.ttl;
                            const isRecord = atomix.valueIs.record(ttl);
                            const isNumber = atomix.valueIs.number(ttl);

                            if (!(isNumber || isRecord)) { throw new TypeError(`The "ttl" property of the "options" object (when provided) must be a number or a record, but instead got ${typeof ttl}`) }

                            if (isNumber) {
                                (configs.ttl as TTLFileOptions).value = ttl;
                            }

                            if (isRecord) {
                                if (hasOwnProp(ttl, 'value')) {
                                    if (!atomix.valueIs.number(ttl.value)) { throw new TypeError(`The "value" property of the "ttl" object (when provided) must be a number, but instead got ${typeof ttl.value}`) }
                                    if (!atomix.valueIs.integer(ttl.value)) { throw new TypeError(`The "value" property of the "ttl" object (when provided) must be an integer, but instead got ${ttl.value}`) }
                                    (configs.ttl as TTLFileOptions).value = ttl.value;
                                }

                                if (hasOwnProp(ttl, 'onExpire')) {
                                    if (typeof ttl.onExpire !== 'function') { throw new TypeError(`The "onExpire" property of the "ttl" object (when provided) must be a function, but instead got ${typeof ttl.onExpire}`) }
                                    (configs.ttl as TTLFileOptions).onExpire = ttl.onExpire;
                                }

                                if (hasOwnProp(ttl, 'policy')) {
                                    if (!atomix.valueIs.string(ttl.policy)) { throw new TypeError(`The "policy" property of the "ttl" object (when provided) must be a string, but instead got ${typeof ttl.policy}`) }
                                    if (!['evict', 'keep'].includes(ttl.policy)) { throw new RangeError(`The "policy" property of the "ttl" object (when provided) must be either "evict" or "keep", but instead got ${ttl.policy}`) }
                                    configs.ttl.policy = ttl.policy;
                                }

                                if (hasOwnProp(ttl, 'sliding')) {
                                    if (typeof ttl.sliding !== 'boolean') { throw new TypeError(`The "sliding" property of the "ttl" object (when provided) must be a boolean, but instead got ${typeof ttl.sliding}`) }
                                    (configs.ttl as TTLFileOptions).sliding = ttl.sliding;
                                }
                            }
                        }

                        return configs;
                    },

                    preloadOptions: {
                        warmup: (options: FilePreloadWarmupSetOptions, normalConfigs: FileNormalSetConfigs): FilePreloadWarmupSetConfigs => {
                            const { preload: _, ...rest } = normalConfigs;
                            const configs: FilePreloadWarmupSetConfigs = {
                                initiator: 'warmup',
                                preload: true,
                                ...rest,
                            }

                            return configs;
                        },

                        restore: (options: FilePreloadRestoreSetOptions, normalConfigs: FileNormalSetConfigs): FilePreloadRestoreSetConfigs => {
                            const { preload: _, ...rest } = normalConfigs;
                            for (const key in rest) {
                                if (!hasOwnProp(rest, key)) { throw new SyntaxError(`The preload restore options object must have a "${key}" property`) }
                            }

                            const configs: FilePreloadRestoreSetConfigs = {
                                initiator: 'restore',
                                preload: true,
                                ...rest,
                                stats: {
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
                                },
                                file: {
                                    path: '',
                                    name: '',
                                    eTag: '',
                                    size: 0,
                                    stats: { size: 0, mtime: 0 },
                                    isCached: false
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
                                        throw new SyntaxError(`The "created" property of the "dates" property of the "stats" object (when provided) is required when "preload" is true`)
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
                                    throw new SyntaxError(`The "dates" property of the "stats" property of the "options" object (when provided) is required when "preload" is true`)
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
                                    throw new SyntaxError(`The "counts" property of the "stats" property of the "options" object (when provided) is required when "preload" is true`)
                                }
                            } else {
                                throw new SyntaxError(`The "stats" property of the "options" object (when provided) is required when "preload" is true`)
                            }

                            if (hasOwnProp(options, 'file')) {
                                const file = options.file;
                                if (!atomix.valueIs.record(file)) { throw new TypeError(`The 'file' property of the "options" object (when provided) must be an object, but instead got ${typeof file}`) }

                                if (hasOwnProp(file, 'path')) {
                                    if (!atomix.valueIs.string(file.path)) { throw new TypeError(`The "path" property of the 'files' object (when provided) must be a string, but instead got ${typeof file.path}`) }
                                    configs.file.path = file.path;
                                } else {
                                    throw new SyntaxError(`The "path" property of the 'files' object (when provided) is required when "preload" is true`)
                                }

                                if (hasOwnProp(file, 'name')) {
                                    if (!atomix.valueIs.string(file.name)) { throw new TypeError(`The "name" property of the 'files' object (when provided) must be a string, but instead got ${typeof file.name}`) }
                                    configs.file.name = file.name;
                                } else {
                                    throw new SyntaxError(`The "name" property of the 'files' object (when provided) is required when "preload" is true`)
                                }

                                if (hasOwnProp(file, 'eTag')) {
                                    if (!atomix.valueIs.string(file.eTag)) { throw new TypeError(`The "eTag" property of the 'files' object (when provided) must be a string, but instead got ${typeof file.eTag}`) }
                                    configs.file.eTag = file.eTag;
                                } else {
                                    throw new SyntaxError(`The "eTag" property of the 'files' object (when provided) is required when "preload" is true`)
                                }

                                if (hasOwnProp(file, 'size')) {
                                    assertPositiveInteger(file.size, 'size', 'files');
                                    configs.file.size = file.size;
                                } else {
                                    throw new SyntaxError(`The "size" property of the 'files' object (when provided) is required when "preload" is true`)
                                }

                                if (hasOwnProp(file, 'stats')) {
                                    const stats = file.stats;
                                    if (!atomix.valueIs.record(stats)) { throw new TypeError(`The "stats" property of the 'files' object (when provided) must be an object, but instead got ${typeof stats}`) }
                                    configs.file.stats = stats;
                                } else {
                                    throw new SyntaxError(`The "stats" property of the 'files' object (when provided) is required when "preload" is true`)
                                }

                                if (hasOwnProp(file, 'isCached')) {
                                    if (typeof file.isCached !== 'boolean') { throw new TypeError(`The "isCached" property of the 'files' object (when provided) must be a boolean, but instead got ${typeof file.isCached}`) }
                                    configs.file.isCached = file.isCached;
                                } else {
                                    throw new SyntaxError(`The "isCached" property of the 'files' object (when provided) is required when "preload" is true`)
                                }
                            } else {
                                throw new SyntaxError(`The 'files' property of the "options" object (when provided) is required when "preload" is true`)
                            }

                            return configs;
                        },

                        any: (options: FilePreloadSetConfigs, normalConfigs: FileNormalSetConfigs): FilePreloadSetConfigs => {
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
                options: (key: string, configs: FilesCacheConfig, options?: FileSetOptions) => {
                    if (options === undefined) { return this.#_helpers.setMethod.defaultConfigs(key, this.#_configs); }

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

                    const normalConfigs = validate.miniHelpers.normalOptions(key, options as FileNormalSetConfigs, configs);
                    return preload ? validate.miniHelpers.preloadOptions.any(options as unknown as FilePreloadSetConfigs, normalConfigs) : normalConfigs;
                }
            }
        },
        generateKey: (filePath: string): string => {
            const normalized = atomix.path.normalizePath(filePath);
            return atomix.http.btoa(normalized);
        }
    }

    readonly #_stats = {
        sizeInMemory: 0,
        counts: {
            read: 0,
            update: 0,
            touch: 0,
            hit: 0,
            miss: 0
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
     * Sets a file in the cache with an optional TTL.
     * If the key already exists, its value and TTL are updated.
     * If the key does not exist and the cache has reached its limit,
     * the least recently used record is removed.
     *
     * @param {string} filePath The path of the file to store in the cache.
     * @param {FileSetOptions} [options] The options to use for setting the file.
     * The following options are available:
     * - `scope`: The scope of the record to set. Defaults to 'global'.
     * - `preload`: Whether or not to preload the record when it is created. Defaults to false.
     * - `ttl`: The time-to-live (TTL) settings for the record. Defaults to the cache's default TTL settings.
     * The `ttl` option can be a number (the TTL in milliseconds) or an object with the following properties:
     *   - `value`: The TTL in milliseconds.
     *   - `onExpire`: The function to call when the record expires.
     *     The function will be called with the record as its argument.
     *   - `policy`: The policy to use when the record expires. Can be either "evict" or "keep". Defaults to "evict".
     * - `key`: The key to use for storing the record. Defaults to the base64-encoded file path.
     * @since v1.0.0
     */
    async set(filePath: string, options?: FileSetOptions) {
        const key = this.#_helpers.generateKey(filePath);
        this.#_helpers.checkIfClearing('set', key);

        try {
            atomix.fs.canAccessSync(filePath, { throwError: true, permissions: 'Read' });
            const configs: FileSetConfigs = this.#_helpers.setMethod.validate.options(key, this.#_configs, options);

            this.#_helpers.cacheManagement.eviction.scheduleEvictionCheck().catch(err => {
                if (err?.message !== 'Debounced function cancelled') { throw err }
            });
            const scopeMap = this.#_helpers.records.getScopeMap(configs.scope);

            if (scopeMap.has(configs.key)) {
                const record = scopeMap.get(configs.key)!;
                return record.touch();
            }

            if (configs.storeIn.length === 0) { configs.storeIn.push(...this.#_defaultEngines) }
            const file = new FileCacheRecord(filePath, configs, this, this.#_enginesProxy, this.#_events);
            scopeMap.set(configs.key, file);

            const preload = configs.preload;
            const initiator = preload === true ? (options as FilePreloadSetOptions)!.initiator : undefined;

            if (preload) {
                await file._init(true, initiator!);
            } else {
                await file._init(false);
            }
        } catch (error) {
            if (error instanceof TypeError) {
                error.message = `Unable to create a file record: ${error.message}`
            }

            throw error;
        }
    }

    /**
     * Retrieves a file from the cache.
     * @param options The options to use when retrieving the file from the cache.
     * The following options are available:
     * - `scope`: The scope of the record to retrieve. Defaults to 'global'.
     * - `key`: The key to retrieve from the cache. If `filePath` is provided, the key is generated by encoding the path in base64.
     * - `filePath`: The path of the file to retrieve from the cache. If `key` is provided, this property is ignored.
     * @returns The content of the file, along with a status indicating whether the content was read from the cache or from the file system, or undefined if the key does not exist in the cache.
     */
    async read(options: FileOptions) {
        try {
            const configs = this.#_helpers.parseFileOptions(options);
            this.#_helpers.checkIfClearing('read', configs.key);

            const record = this.#_helpers.records.getRecord(configs);
            if (!record) { return undefined }

            const response = await record.read();
            return response;
        } catch (error) {
            if (error instanceof TypeError) {
                error.message = `Unable to read a file record: ${error.message}`
            }

            throw error;
        }
    }

    /**
     * Retrieves the file record from the cache as a plain object.
     * The following options are available:
     * - `scope`: The scope of the record to retrieve. Defaults to 'global'.
     * - `key`: The key to retrieve from the cache. If `filePath` is provided, the key is generated by encoding the path in base64.
     * - `filePath`: The path of the file to retrieve from the cache. If `key` is provided, this property is ignored.
     * @returns The file record as a plain object, or undefined if the key does not exist in the cache.
     */
    inspect(options: FileOptions) {
        try {
            const configs = this.#_helpers.parseFileOptions(options);
            this.#_helpers.checkIfClearing('get', configs.key);

            const record = this.#_helpers.records.getRecord(configs);
            if (!record) { return undefined }

            return record.toJSON();
        } catch (error) {
            if (error instanceof TypeError) {
                error.message = `Unable to get the file record: ${error.message}`
            }

            throw error;
        }
    }

    /**
     * Removes a file record from the cache.
     * @param options The options to use when removing the file record from the cache.
     * The following options are available:
     * - `scope`: The scope of the record to remove. Defaults to 'global'.
     * - `key`: The key to remove from the cache. If `filePath` is provided, the key is generated by encoding the path in base64.
     * - `filePath`: The path of the file to remove from the cache. If `key` is provided, this property is ignored.
     * @returns A boolean indicating whether the record was successfully removed from the cache.
     * @since v1.0.0
     */
    async remove(options: FileOptions): Promise<boolean> {
        const configs = this.#_helpers.parseFileOptions(options);
        this.#_helpers.checkIfClearing('remove', configs.key);
        return this.#_helpers.createRemovePromise(configs.key, configs.scope);
    }

    /**
     * Checks if a file record exists in the cache.
     * 
     * @param options The options to use when checking for the file record in the cache.
     * The following options are available:
     * - `scope`: The scope of the record to check. Defaults to 'global'.
     * - `key`: The key of the record to check. If `filePath` is provided, the key is generated by encoding the path in base64.
     * - `filePath`: The path of the file to check in the cache. If `key` is provided, this property is ignored.
     * 
     * @returns A boolean indicating whether the file record exists in the cache.
     * @throws {TypeError} If there is an error processing the file options.
     * @since v1.0.0
     */
    has(options: FileOptions): boolean {
        const configs = this.#_helpers.parseFileOptions(options);
        this.#_helpers.checkIfClearing('has', configs.key);

        const scopeMap = this.#_helpers.records.getScopeMap(configs.scope);
        return scopeMap.has(configs.key);
    }

    /**
     * Retrieves the total number of files stored in the cache across all scopes.
     * @returns {number} The total number of files in the cache.
     */
    get size(): number {
        let size = 0;
        this.#_files.forEach(scopeMap => size += scopeMap.size);
        return size
    }

    /**
     * Retrieves the statistics of the cache, including the number of read, update, touch, hit, and miss operations.
     * @returns An object containing the statistics of the cache.
     */
    get stats() {
        const cloned = atomix.dataTypes.object.smartClone(this.#_stats);
        return atomix.dataTypes.record.deepFreeze(cloned);
    }

    /**
     * Retrieves the configuration object for the file cache.
     * This object contains the settings for time-to-live (TTL) and
     * other cache management policies.
     * @returns The configuration object for the file cache.
     * @since v1.0.0
     */
    get configs() { return this.#_configs }

    /**
     * Clears the cache for the specified scope or all scopes if no scope is provided.
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
                    const mainMap = new Map() as FilesMainRecord;
                    mainMap.set(scope, scopeMap);
                    return mainMap
                } else {
                    return this.#_files;
                }
            })();

            const iterator = helpers.records.createIterator(recordsMap);
            const records: FileCacheRecord[] = [];
            const stats = Object.seal({ read: 0, update: 0, touch: 0, hit: 0, miss: 0 });

            const remove = async () => {
                if (records.length === 0) { return }
                await this.#_events.emit.bulkRemove(records, { reason: 'manual' });

                this.#_stats.counts.read -= stats.read;
                this.#_stats.counts.update -= stats.update;
                this.#_stats.counts.touch -= stats.touch;
                this.#_stats.counts.hit -= stats.hit;
                this.#_stats.counts.miss -= stats.miss;

                records.length = stats.read = stats.update = stats.touch = stats.hit = stats.miss = 0;
            }

            for (const { record } of iterator) {
                stats.read += record.stats.counts.read;
                stats.update += record.stats.counts.update;
                stats.touch += record.stats.counts.touch;
                stats.hit += record.stats.counts.hit;
                stats.miss += record.stats.counts.miss;

                records.push(record as FileCacheRecord);
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
     * Exports all cached file records to the specified persistent storage service.
     *
     * This method performs a full backup of the current file cache. If a backup
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
     * await cachify.files.backup('s3', 'backups/data-2025-07-27');
     * 
     * @example
     * await cachify.files.backup('local', './backup/records-2025-07-27');
     * @since v1.0.0
     */
    async backup<S extends StorageServices>(to: S, ...args: BackupParameters<S>): Promise<void> {
        if (this.#_flags.blocking.backingUp) { return }

        try {
            this.#_helpers.startBlockingProcess('backingUp');

            const data = { source: 'files' as CacheFlavor, content: this.#_files }
            await this.#_persistenceProxy.backup(data, to, ...args);
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
     * await cachify.files.restore('s3', 'backups/data-2025-07-27');
     * 
     * @example
     * await cachify.files.restore('local', './backup/records-2025-07-27');
     * @since v1.0.0
     */
    async restore<S extends StorageServices>(from: S, ...args: RestoreParameters<S>): Promise<void> {
        if (this.#_flags.blocking.restoring) { return }

        try {
            this.#_helpers.startBlockingProcess('restoring');
            await this.#_persistenceProxy.restore('files', from, ...args);
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
    toString(): string { return 'FilesCacheManager' }
}

export default FilesCacheManager
type FilesMainRecord = Map<string, Map<string, FileCacheRecord>>;
type InternalIOConfigs = {
    caseSensitive: boolean;
    filePath: string;
    scope: string;
    key: string;
}