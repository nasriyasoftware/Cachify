import { Brand } from "@nasriya/atomix";
import FileCacheRecord from "../memory/files/file";
import KVCacheRecord from "../memory/kv/record";
import KVCacheManager from "../memory/kv/manager";
import FileCacheManager from "../memory/files/manager";
// Import the database cache record type

import { FileCacheRecordJSON, KVCacheRecordJSON } from "../events/docs";
import { CACHE_PRELOAD_INITIATORS } from "../consts/consts";

export type CacheMetaData = {
    kv: {
        manager: KVCacheManager;
        record: KVCacheRecord;
        jsonRecord: KVCacheRecordJSON
    }

    files: {
        manager: FileCacheManager;
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
