import type { Brand } from "@nasriya/atomix";
import FileCacheRecord from "../flavors/files/files.record";
import KVCacheRecord from "../flavors/kvs/kvs.record";
import KVsCacheManager from "../flavors/kvs/kvs.manager";
import FilesCacheManager from "../flavors/files/files.manager";
// Import the database cache record type

import { EventsManagers, FileCacheRecordJSON, KVCacheRecordJSON } from "../events/docs";
import { CACHE_PRELOAD_INITIATORS } from "../consts/consts";
import EnginesProxy from "../engines/EnginesProxy";
import PersistenceProxy from "../persistence/proxy";

export type CacheMetaData = {
    kvs: {
        manager: KVsCacheManager;
        record: KVCacheRecord;
        jsonRecord: KVCacheRecordJSON
    }

    files: {
        manager: FilesCacheManager;
        record: FileCacheRecord;
        jsonRecord: FileCacheRecordJSON
    }

    // database: {
    //     manager: unknown;
    //     record: unknown;
    //     jsonRecord: unknown
    // }
}

/** Cache records managed by the cache manager. */
export type CacheRecord = KVCacheRecord | FileCacheRecord;
export type RefreshableCacheRecord = FileCacheRecord;
export type CacheFlavor = keyof CacheMetaData;
export type CacheScope = Brand<string, 'CacheScope'>;
export type CachePreloadInitiator = typeof CACHE_PRELOAD_INITIATORS[number];

export type BlockingFlags = {
    clearing: boolean;
    backingUp: boolean;
    restoring: boolean;
};

// Then use:
export type BlockingProcess = keyof BlockingFlags;

export type CacheData<K extends CacheFlavor> = {
    source: K;
    content: Map<string, Map<string, CacheMetaData[K]['record']>>;
}

export type CacheManagerAssets<T extends CacheFlavor> = {
    enginesProxy: EnginesProxy;
    persistenceProxy: PersistenceProxy;
    eventsManager: EventsManagers[T];
}