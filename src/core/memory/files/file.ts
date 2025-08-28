import atomix from "@nasriya/atomix";
import cachify from "../../../cachify";
import overwatch from "@nasriya/overwatch";
import Watcher from "@nasriya/overwatch/dist/@types/watcher/Watcher";
import cron, { ScheduledTimedTask } from "@nasriya/cron";

import TTLItemConfig from "../../configs/strategies/ttl/TTLItemConfig";
import fileEventsManager from "../../events/managers/file/FileEventsManager";
import engineProxy from "../../engines/proxy";

import fs from 'fs';
import path from 'path';
import { FileCacheReadResponse, FileSetConfigs } from "./docs";
import { CachePreloadInitiator } from "../../docs/docs";

class FileCacheRecord {
    readonly #_flavor: 'files' = 'files';
    readonly #_engines: string[] = [];
    readonly #_scope: string = 'global';
    /** The `filePath` encoded in base64 */
    #_key: string;
    #_expireJob: ScheduledTimedTask = {} as unknown as ScheduledTimedTask;
    #_initialized = false;

    readonly #_content = Object.seal({
        size: 0
    })

    readonly #_data = {
        file: {
            path: '',
            name: '',
            eTag: '',
            stats: {} as fs.Stats
        },
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
                miss: 0,
                hit: 0
            }
        }
    }

    readonly #_configs = {
        ttl: undefined as TTLItemConfig | undefined,
        watcher: {
            task: null as unknown as Watcher,
            systemHandlers: Object.freeze({
                onUpdate: async (event: unknown) => {
                    if (this.isContentCached) {
                        await this.refresh();
                    }
                },
                onRemove: async () => {
                    await fileEventsManager.emit.remove(this, { reason: 'file.delete' });
                },
                onRename: async () => {
                    await fileEventsManager.emit.remove(this, { reason: 'file.rename' });
                }
            })
        }
    }

    constructor(filePath: string, configs: FileSetConfigs) {
        this.#_scope = configs.scope;
        this.#_engines = configs.storeIn;
        if (configs.ttl.value > 0) {
            this.#_configs.ttl = new TTLItemConfig(configs.ttl);
        }

        if (configs.preload) {
            this.#_key = configs.key;
            this.#_data.file.path = filePath;
            this.#_data.file.name = path.basename(filePath);

            switch (configs.initiator) {
                case 'warmup': {
                    this.#_data.stats.dates.created = Date.now();
                }
                    break;

                case 'restore': {
                    this.#_data.stats = configs.stats;
                }
                    break;
            }
        } else {
            this.#_data.file.path = filePath;
            this.#_data.file.name = path.basename(filePath);
            this.#_key = atomix.http.btoa(filePath);
            this.#_data.stats.dates.created = Date.now();
        }

        fileEventsManager.on('remove', (event) => {
            if (event.item.key === this.#_key) {
                this.#_expireJob?.cancel?.();
            }
        }, { once: true });
    }

    readonly #_helpers = Object.freeze({
        loadContent: async () => {
            await this.#_helpers.updateFileStats();
            const content = await fs.promises.readFile(this.#_data.file.path);

            this.#_data.stats.counts.update++;
            this.#_data.stats.dates.lastUpdate = Date.now();
            this.#_data.file.eTag = atomix.http.btoa(`${this.#_data.file.stats.size}-${this.#_data.file.stats.mtimeMs}`);
            this.#_helpers.refreshTTL();

            // Storing content
            await engineProxy.set(this, content);

            const delta = content.length - this.#_content.size;
            this.#_content.size = content.length;
            if (delta !== 0) {
                await fileEventsManager.emit.contentSizeChange(this, delta);
            }
        },
        checkSizeQuota: async () => {
            const firstRun = this.#_initialized === false;
            const maxFileSize = cachify.files.configs.maxFileSize;

            /** The file size gotten from the file stats */
            const fileSize = this.#_data.file.stats.size;

            if (fileSize > maxFileSize) {
                if (firstRun) {
                    throw new RangeError(`The file "${this.#_data.file.name}" is larger than the maximum allowed size of ${maxFileSize} bytes`);
                } else {
                    await fileEventsManager.emit.remove(this, { reason: 'file.exceedSizeLimit' });
                    return;
                }
            }
        },
        watch: async () => {
            return new Promise((resolve, reject) => {
                overwatch.watchFile(this.#_data.file.path, {
                    onUpdate: this.#_configs.watcher.systemHandlers.onUpdate,
                    onRemove: this.#_configs.watcher.systemHandlers.onRemove,
                    onRootRemoved: this.#_configs.watcher.systemHandlers.onRemove,
                    onRename: this.#_configs.watcher.systemHandlers.onRename
                }).then(watcher => {
                    this.#_configs.watcher.task = watcher;
                    resolve(watcher);
                }).catch(reject);
            })
        },
        updateFileStats: async () => {
            this.#_data.file.stats = await fs.promises.stat(this.#_data.file.path);
            await this.#_helpers.checkSizeQuota();
        },
        refreshTTL: () => {
            const ttlConfig = this.#_configs.ttl;
            if (!ttlConfig) { return }
            const ttl = ttlConfig.value
            if (ttl === 0) { return }

            const sliding = ttlConfig.sliding;
            const baseTime = sliding ?
                this.#_data.stats.dates.lastAccess || this.#_data.stats.dates.created :
                this.#_data.stats.dates.created;

            const expireAt = baseTime + ttl;
            if (expireAt === this.#_data.stats.dates.expireAt) { return }

            this.#_data.stats.dates.expireAt = expireAt;
            this.#_expireJob?.cancel?.();
            this.#_expireJob = cron.scheduleTime(expireAt, async () => {
                ttlConfig?.onExpire?.(this);
                await fileEventsManager.emit.expire(this);
            });
        },
        registerAccess: () => {
            this.#_data.stats.dates.lastAccess = Date.now();
            this.#_helpers.refreshTTL();
        }
    })

    /**
     * Initializes the file cache record.
     * If the record is already initialized, this method does nothing.
     * Otherwise, it updates the file stats, watches the file for changes, refreshes the TTL, and emits a `create` event.
     * @param preload - Whether to preload the record upon creation.
     * @param initiator - The preload initiator, if the record is preloaded.
     */
    _init(preload: false): Promise<void>;
    _init(preload: true, initiator: CachePreloadInitiator): Promise<void>;
    async _init(preload: boolean, initiator?: CachePreloadInitiator): Promise<void> {
        try {
            if (this.#_initialized) { return }
            await this.#_helpers.updateFileStats();
            await this.#_helpers.watch();
            this.#_helpers.refreshTTL();
            await fileEventsManager.emit.create(this, { preload });
            if (initiator === 'warmup') { await this.#_helpers.loadContent() }
        } catch (error) {
            throw error;
        } finally {
            this.#_initialized = true;
        }
    }

    /**
     * Retrieves the content of the file.
     * If the content is not available (i.e., the file has not been read yet), it reads the file and caches the content.
     * If the content is available, it returns the cached content.
     * The record's last access date is updated and the read count is incremented by one.
     * The record's TTL is refreshed.
     * If the record has been read before, it emits a `hit` event.
     * If the record has not been read before, it emits a `miss` event.
     * @returns {Promise<{ status: 'hit' | 'miss'; content: string; }>} The content of the file, along with a status indicating whether the content was read from the cache or from the file system.
     */
    async read(): Promise<FileCacheReadResponse> {
        const hasContent = this.isContentCached;
        if (!hasContent) { await this.#_helpers.loadContent() }

        /**
         * The status of the read operation.
         * If the content is available, it is a hit.
         * If the content is not available, it is a miss.
         * It's about whether the content is cached or not, not whether the
         * record has been read before.
         */
        const status = hasContent ? 'hit' : 'miss';

        this.#_data.stats.counts.read++;
        this.#_data.stats.counts[status]++;
        this.#_helpers.registerAccess();

        const response = await engineProxy.read(this);
        await fileEventsManager.emit.read(this, { status });
        return { status: hasContent ? 'hit' : 'miss', content: response.value }
    }

    /**
     * Updates the record's last access date and emits a `touch` event.
     * This method is used to update the record's metadata without modifying the value.
     */
    async touch() {
        this.#_data.stats.counts.touch++;
        this.#_helpers.registerAccess();
        await fileEventsManager.emit.touch(this);
    }

    /**
     * Refreshes the cache record by reloading the content from the file.
     * If the content has changed, emits an `update` event.
     * @returns {Promise<void>}
     */
    async refresh(): Promise<void> {
        await this.#_helpers.loadContent();
        await fileEventsManager.emit.update(this);
    }

    /**
     * Removes the file content from memory.
     * This keeps the record metadata but frees up memory used by the cached file content.
     * Useful for managing memory in long-running applications.
     */
    async clearContent() {
        const delta = -this.#_content.size;
        this.#_content.size = 0;
        if (delta !== 0) {
            await fileEventsManager.emit.contentSizeChange(this, delta);
        }
    }

    /**
     * Checks if the file content is cached.
     * @returns {boolean} `true` if the file content is available in the cache, `false` otherwise.
     */
    get isContentCached(): boolean { return this.#_content.size > 0 }

    /**
     * Retrieves the statistics for the cache record.
     * The statistics include the dates of creation, last access, last update, and expiration, as well as the counts of access, update, and touch events.
     * @returns The statistics of the cache record.
     */
    get stats() {
        const cloned = atomix.dataTypes.object.smartClone(this.#_data.stats);
        return atomix.dataTypes.record.deepFreeze(cloned);
    }

    /**
     * Retrieves the list of engines associated with the cache record.
     * @returns {string[]} An array of engine names.
     */
    get engines(): string[] { return this.#_engines }

    /**
     * Retrieves the flavor of the cache record.
     * @returns {'files'} The flavor of the cache record.
     */
    get flavor(): 'files' { return this.#_flavor }

    /**
     * Retrieves the key associated with the cache record.
     * @returns {string} The key associated with the cache record.
     */
    get key(): string { return this.#_key }

    /**
     * Retrieves the scope associated with the cache record.
     * @returns {string} The scope associated with the cache record.
     */
    get scope(): string { return this.#_scope }

    /**
     * Retrieves an immutable view of the file information.
     * The information includes the file path, name, entity tag (eTag), and size.
     * @returns An immutable record containing the file's path, name, eTag, and size.
     */
    get file() {
        return atomix.dataTypes.record.deepFreeze({
            path: this.#_data.file.path,
            name: this.#_data.file.name,
            eTag: this.#_data.file.eTag,
            size: this.#_data.file.stats.size,
            stats: this.#_data.file.stats,
            isCached: this.isContentCached
        })
    }

    /**
     * Converts the cache record to a JSON object.
     * The JSON object will contain the cache record's flavor, scope, key, statistics, file information, and TTL configuration.
     * @returns The JSON object representation of the cache record.
     */
    toJSON() {
        const cloned = atomix.dataTypes.object.smartClone({
            flavor: this.flavor,
            engines: this.#_engines,
            scope: this.scope,
            key: this.key,
            stats: this.stats,
            file: this.file,
            ttl: {
                value: this.#_configs.ttl ? this.#_configs.ttl.value : 0,
                sliding: this.#_configs.ttl ? this.#_configs.ttl.sliding : false
            }
        })

        return atomix.dataTypes.record.deepFreeze(cloned);
    }

    /**
     * Exports the file cache record to a JSON-compatible object.
     * The exported object includes the record's flavor, engines, scope, key, statistics, file information, TTL configuration, and the base64-encoded file content.
     * If the file content does not exist in the cache, it returns undefined.
     * This method is intended for use in backing up the file cache records.
     * 
     * @returns A promise that resolves to the JSON object representation of the file cache record, or undefined if no content exists.
     */
    async export() {
        return {
            flavor: this.flavor,
            engines: this.#_engines,
            scope: this.scope,
            key: this.key,
            stats: this.#_data.stats,
            file: {
                path: this.#_data.file.path,
                name: this.#_data.file.name,
                eTag: this.#_data.file.eTag,
                size: this.#_data.file.stats.size,
                stats: this.#_data.file.stats,
                isCached: this.isContentCached
            },
            ttl: {
                value: this.#_configs.ttl ? this.#_configs.ttl.value : 0,
                sliding: this.#_configs.ttl ? this.#_configs.ttl.sliding : false
            },
        }
    }
}

export default FileCacheRecord;

