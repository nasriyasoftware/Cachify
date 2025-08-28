import atomix from "@nasriya/atomix";
import cron, { ScheduledTask } from "@nasriya/cron";

import FileCacheRecord from "./file";
import FileCacheConfig from "../../configs/managers/file/FileCacheConfig";
import fileEventsManager from "../../events/managers/file/FileEventsManager";
import helpers from "../helpers";

import { CacheStatusChangeHandler } from "../../configs/strategies/docs";
import { BaseQueueTask, TasksQueue } from "@nasriya/atomix/tools";
import { FileContentSizeChangeEvent } from "../../events/docs";

import persistenceProxy from "../../persistence/proxy";
import engineProxy from "../../engines/proxy";
import filesHelpers from "./helpers";
import { BlockingFlags, BlockingProcess, CacheFlavor } from "../../docs/docs";
import { BackupParameters, RestoreParameters, StorageServices } from "../../persistence/docs";
import { FileKeyOptions, FileOptions, FilePathOptions, FilePreloadSetOptions, FileSetConfigs, FileSetOptions } from "./docs";

class FileCacheManager {
    readonly #_files: FilesMainRecord = new Map();
    readonly #_configs: FileCacheConfig;
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

            this.#_configs = new FileCacheConfig(onCacheStatusChange);
        }

        // Prepare the scheduled task to clean up idle items
        {
            this.#_jobs.clearIdleItems = cron.schedule(
                cron.time.every(5).minutes(),
                this.#_helpers.cacheManagement.idle.createCleanHandler(),
                {
                    runOnInit: false,
                    name: 'file_clean_idle_items'
                }
            )
        }

        // Listen on events to update stats
        {
            fileEventsManager.on('remove', async event => {
                if (event.flavor === 'files') {
                    const scopeMap = this.#_helpers.records.getScopeMap(event.item.scope);
                    const record = scopeMap.get(event.item.key)!;
                    if (record) {
                        await engineProxy.remove(record);
                        scopeMap.delete(event.item.key);
                    }
                }
            }, { type: 'beforeAll' });

            fileEventsManager.on('read', event => {
                this.#_stats.counts.read++;
            }, { type: 'beforeAll' });

            fileEventsManager.on('update', event => {
                this.#_stats.counts.update++;
            }, { type: 'beforeAll' });

            fileEventsManager.on('touch', event => {
                this.#_stats.counts.touch++;
            }, { type: 'beforeAll' });

            fileEventsManager.on('hit', event => {
                this.#_stats.counts.hit++;
            }, { type: 'beforeAll' });

            fileEventsManager.on('miss', event => {
                this.#_stats.counts.miss++;
            }, { type: 'beforeAll' });

            fileEventsManager.on('fileContentSizeChange', event => {
                this.#_memoryManager.handle(event);
            }, { type: 'beforeAll' });
        }
    }

    readonly #_memoryManager = {
        data: {
            sortingHandler: (a: FileCacheRecord, b: FileCacheRecord) => {
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
            }
        },
        cacheManagement: {
            idle: {
                createCleanHandler: (): () => Promise<void> => {
                    return helpers.cacheManagement.idle.createCleanHandler(this.#_files, this.#_configs.idle, fileEventsManager);
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
                                eventsManager: fileEventsManager,
                                getSize: () => this.size
                            });
                        }
                    }

                    this.#_queue.addTask(task);
                }, 100)
            }
        },
        parseFileOptions: (options: FileOptions): Required<FileKeyOptions> => {
            const configs: Required<FileKeyOptions> = {
                scope: 'global',
                key: undefined as unknown as string
            }

            if (!atomix.valueIs.record(options)) { throw new TypeError(`The "options" argument must be a record, but instead got ${typeof options}`) }
            const hasOwnProperty = atomix.dataTypes.record.hasOwnProperty;
            const hasKey = hasOwnProperty(options, 'key');
            const hasScope = hasOwnProperty(options, 'scope');
            const hasFilePath = hasOwnProperty(options, 'filePath');

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
                    configs.key = atomix.http.btoa(filePath);
                }
            } else {
                throw new SyntaxError(`The "options" object must have either a "key" or a "filePath" property.`);
            }

            return configs;
        },
        checkIfClearing: (operation: 'get' | 'set' | 'touch' | 'remove' | 'read' | 'has', key: string) => {
            if (this.#_flags.blocking.clearing) { throw new Error(`Cannot ${operation} (${key}) while clearing`) }
        },
        createRemovePromise: async (key: string, scope: string = 'global'): Promise<boolean> => {
            const scopeMap = this.#_helpers.records.getScopeMap(scope);
            const record = scopeMap.get(key);
            if (!record) { return false }

            await fileEventsManager.emit.remove(record, { reason: 'manual' });
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
            touch: 0,
            hit: 0,
            miss: 0
        }
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
        const key = atomix.http.btoa(filePath);
        this.#_helpers.checkIfClearing('remove', key);

        try {
            atomix.fs.canAccessSync(filePath, { throwError: true, permissions: 'Read' });
            const configs: FileSetConfigs = filesHelpers.validate.setOptions(key, this.#_configs, options);

            this.#_helpers.cacheManagement.eviction.scheduleEvictionCheck().catch(err => {
                if (err?.message !== 'Debounced function cancelled') { throw err }
            });
            const scopeMap = this.#_helpers.records.getScopeMap(configs.scope);

            if (scopeMap.has(configs.key)) {
                const record = scopeMap.get(configs.key)!;
                return record.touch();
            }

            if (configs.storeIn.length === 0) { configs.storeIn.push('memory') }
            const file = new FileCacheRecord(filePath, configs);
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
            this.#_helpers.checkIfClearing('remove', configs.key);

            const scopeMap = this.#_helpers.records.getScopeMap(configs.scope);
            const record = scopeMap.get(configs.key);
            if (!record) { return undefined }

            const response = await record.read();
            await fileEventsManager.emit.read(record, { status: response.status });
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
            this.#_helpers.checkIfClearing('remove', configs.key);

            const scopeMap = this.#_helpers.records.getScopeMap(configs.scope);
            const record = scopeMap.get(configs.key);
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
        this.#_helpers.checkIfClearing('remove', configs.key);

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

            const records = (() => {
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

            const queue = new TasksQueue({ autoRun: true, concurrencyLimit: 1000 });

            for (const [_, scopeMap] of records) {
                for (const [_, record] of scopeMap) {
                    this.#_stats.counts.read -= record.stats.counts.read;
                    this.#_stats.counts.touch -= record.stats.counts.touch;
                    this.#_stats.counts.update -= record.stats.counts.update;
                    this.#_stats.counts.hit -= record.stats.counts.hit;
                    this.#_stats.counts.miss -= record.stats.counts.miss;

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
                fileEventsManager.dispose();
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
            await persistenceProxy.backup(data, to, ...args);
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
            await persistenceProxy.restore('files', from, ...args);
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
    toString(): string { return 'FileCacheManager' }
}

export default FileCacheManager
type FilesMainRecord = Map<string, Map<string, FileCacheRecord>>;