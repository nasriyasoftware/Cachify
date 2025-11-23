import IdleConfig from "../configs/strategies/idle/IdleConfig";
import EvictConfig from "../configs/strategies/evict/EvictConfig";
import * as constants from "../consts/consts";
import { CacheRecord } from "../docs/docs";
import { EventsManager } from "../events/docs";
import KVCacheRecord from "./kvs/kvs.record";
import FileCacheRecord from "./files/files.record";
import { FilesEventsManager } from "../events/managers/files/FilesEventsManager";
import { KVsEventsManager } from "../events/managers/kvs/KVsEventsManager";

class CacheHelpers {
    estimateValueSize(value: unknown, seen = new WeakSet()): number {
        if (value === null || value === undefined) { return 0 }

        const type = typeof value;

        if (type === 'boolean') return 4;
        if (type === 'number') return 8;
        if (type === 'string') return (value as string).length * 2;
        if (type === 'symbol') return 8;
        if (type === 'function') return 0;

        if (Buffer.isBuffer(value)) return value.length;

        if (ArrayBuffer.isView(value)) return (value as ArrayBufferView).byteLength;

        if (typeof value === 'object') {
            if (seen.has(value)) return 0;
            seen.add(value);

            let bytes = constants.OBJECT_OVERHEAD;

            if (Array.isArray(value)) {
                for (const item of value) {
                    bytes += this.estimateValueSize(item, seen);
                }
            } else if (value instanceof Map) {
                for (const [k, v] of value.entries()) {
                    bytes += this.estimateValueSize(k, seen);
                    bytes += this.estimateValueSize(v, seen);
                }
            } else if (value instanceof Set) {
                for (const v of value.values()) {
                    bytes += this.estimateValueSize(v, seen);
                }
            } else {
                for (const [key, val] of Object.entries(value)) {
                    bytes += key.length * 2;
                    bytes += this.estimateValueSize(val, seen);
                }
            }

            return bytes;
        }

        return 0;
    }

    readonly records = {
        getScopeMap: <T extends CacheRecord>(scope: string, map: Map<string, Map<string, T>>) => {
            if (!map.has(scope)) { map.set(scope, new Map()) }
            return map.get(scope)!;
        },
        toArray: <T extends CacheRecord>(map: Map<string, Map<string, T>>) => {
            const arr = new Array<CacheRecord>();
            for (const [scope, scopeMap] of map) {
                for (const [key, record] of scopeMap) {
                    if (!(record as any instanceof KVCacheRecord || record as any instanceof FileCacheRecord)) {
                        console.warn(`[WARN] Non-CacheRecord found at ${scope}:${key}`);
                        console.dir(record);
                        continue;
                    }

                    arr.push(record);
                }
            }
            return arr;
        },
        sortBy: {
            oldest: <T extends CacheRecord>(maps: Map<string, Map<string, T>>) => {
                const arr = this.records.toArray(maps);
                return arr.sort((a, b) => Number(a.stats.dates.created - b.stats.dates.created));
            },
            leastRecentlyUsed: <T extends CacheRecord>(maps: Map<string, Map<string, T>>) => {
                const arr = this.records.toArray(maps);
                return arr.sort((a, b) => {
                    const lastAccessA = a.stats.dates.lastAccess || a.stats.dates.created;
                    const lastAccessB = b.stats.dates.lastAccess || b.stats.dates.created;
                    return Number(lastAccessA - lastAccessB);
                });
            },
            leastFrequentlyUsed: <T extends CacheRecord>(maps: Map<string, Map<string, T>>) => {
                const arr = this.records.toArray(maps);
                return arr.sort((a, b) => {
                    const countA = a.stats.counts.touch + a.stats.counts.read;
                    const countB = b.stats.counts.touch + b.stats.counts.read;
                    return Number(countA - countB);
                });
            }
        },
        createIterator: function* (recordsMap: Map<string, Map<string, CacheRecord>>) {
            for (const [_, scopeMap] of recordsMap) {
                for (const [_, record] of scopeMap) {
                    yield { map: scopeMap, record };
                }
            }
        },
        estimateSize: (key: string, value: unknown) => {
            const keyLength = Buffer.byteLength(key);
            const valueLength = this.estimateValueSize(value);
            return keyLength + valueLength;
        }
    }

    readonly cacheManagement = {
        idle: {
            /**
             * Creates a function that cleans up idle cache records.
             * This generated function, when executed, iterates over all cache records and checks
             * their last access time against the configured maximum idle time.
             * If a record has been idle for longer than the allowed duration, it is removed from the cache.
             * This function does nothing if idle timeout is not enabled.
             * 
             * @returns A function that performs the idle cleanup asynchronously.
             */
            createCleanHandler: <T extends CacheRecord>(
                records: Map<string, Map<string, T>>,
                policy: IdleConfig,
                eventsManager: EventsManager
            ): () => Promise<void> => {
                return async () => {
                    if (!policy.enabled) { return }

                    for (const [_, scopeMap] of records) {
                        for (const [_, record] of scopeMap) {
                            const lastActivity = record.stats.dates.lastAccess || record.stats.dates.created;
                            const diff = Date.now() - lastActivity;

                            if (diff > policy.maxIdleTime) {
                                await eventsManager.emit.evict(record as any, { reason: 'idle' });
                            }
                        }
                    }
                }
            }
        },
        eviction: {
            async evictIfEnabled<T extends CacheRecord>(
                configs: {
                    records: Map<string, Map<string, T>>,
                    policy: EvictConfig,
                    getSize: () => number,
                    eventsManager: EventsManager
                }
            ) {
                const { records, policy, getSize, eventsManager } = configs;
                // =======
                /// Validating arguments
                if (!(records instanceof Map)) { throw new TypeError('records must be a Map'); }
                if (!(policy instanceof EvictConfig)) { throw new TypeError('policy must be an EvictConfig'); }
                if (typeof getSize !== 'function') { throw new TypeError('getSize must be a function'); }
                if (typeof getSize() !== 'number') { throw new TypeError('getSize must return a number'); }
                if (!(eventsManager instanceof FilesEventsManager || eventsManager instanceof KVsEventsManager)) {
                    throw new TypeError('eventsManager must be a FilesEventsManager or KVsEventsManager');
                }
                // =======
                if (!policy.enabled || records.size === 0) { return }
                const mode = policy.mode;

                const eviction = Object.seal({
                    items: this.getItems(records, policy),
                    hasNext() {
                        return this.items.length > 0 && getSize() > policy.maxRecords;
                    },
                    async next() {
                        if (!this.hasNext()) { return }
                        const item = this.items.shift()!;
                        await (eventsManager as any).emit.evict(item, { reason: mode });
                    }
                })

                while (eviction.hasNext()) {
                    await eviction.next();
                }
            },
            getItems: <T extends CacheRecord>(maps: Map<string, Map<string, T>>, policy: EvictConfig) => {
                const mode = policy.mode;
                switch (mode) {
                    case 'fifo': {
                        // First-In-First-Out: evict the oldest item added.
                        return this.records.sortBy.oldest(maps);
                    }
                    case 'lru': {
                        // Least Recently Used: evict the item with the oldest lastAccess timestamp.
                        return this.records.sortBy.leastRecentlyUsed(maps);
                    }
                    case 'lfu': {
                        // Least Frequently Used: evict the item with the lowest access count.
                        return this.records.sortBy.leastFrequentlyUsed(maps);
                    }
                    default: {
                        return [];
                    }
                }
            }
        }
    }
}

const helpers = new CacheHelpers();
export default helpers;