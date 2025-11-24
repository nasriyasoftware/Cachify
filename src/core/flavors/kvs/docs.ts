import KVCacheRecord from "./kvs.record";
import CacheSession from "../../sessions/CacheSession";
import type { TTLKVOptions } from "../../configs/strategies/docs";
import type { Prettify, RequiredStrict } from "@nasriya/atomix";

type KVTypeMap = {
    options: {
        normal: {
            /**
             * Whether or not to emit a 'preload' event when the record is created.
             * If not provided, the default preload behavior from the cache's configuration is used.
             * 
             * This property is intended to be used when the cache manager
             * loads the records from persistent storage.
             * @private
             * @since v1.0.0
             */
            preload?: false;

            /**
             * The scope of the record.
             * If not provided, the default scope from the cache's configuration is used.
             * @default 'global'
             * 
             * @example
             * cachify.kvs.set('key', 'value', { scope: 'user' });
             * @since v1.0.0
             */
            scope?: string;

            /**
             * Specifies the storage engine(s) where this cache record should be stored.
             *
             * Each value must match the name of a registered engine (e.g., "memory", "redis", or a custom-defined name).
             * If multiple engines are provided, the record will be written to all of them. When reading, the system will
             * attempt to read from the engines in the order they are listed.
             *
             * If this field is not provided, the record will default to being stored only in the "memory" engine.
             *
             * @example
             * storeIn: 'memory' // Store in memory only
             * storeIn: ['redis'] // Store in Redis only
             * storeIn: ['memory', 'redis'] // Store in both, prefer memory for reads
             *
             * @since v1.0.0
             */
            storeIn?: string | string[];

            /**
             * The time to live in milliseconds for the record. Must be at least `5000` ms
             * or a `TTLKVOptions` object.
             * 
             * @example
             * cachify.kvs.set('key', 'value', { ttl: 5000 });
             * @example
             * cachify.kvs.set('key', 'value', { ttl: { value: 5000, onExpire: (record) => console.log(`Record ${record.key} has expired.`) } });
             * @since v1.0.0
             */
            ttl?: number | TTLKVOptions;
        };

        preload: {
            restore: Prettify<{ preload: true, initiator: 'restore' } & Omit<KVCacheRecordExportedData, 'key' | 'value' | 'flavor' | 'engines' | 'ttl'> & { ttl: TTLKVOptions; storeIn: string[] }>;
            warmup: Prettify<{ preload: true, initiator: 'warmup' } & Omit<KVTypeMap['options']['normal'], 'preload' | 'ttl' | 'storeIn'> & { ttl?: TTLKVOptions; storeIn?: string[] }>;
        }
    }

    configs: {
        normal: Prettify<RequiredStrict<
            Omit<KVTypeMap['options']['normal'], 'ttl' | 'storeIn'>
        > & { ttl: TTLKVOptions; storeIn: string[] }>;

        preload: {
            restore: Prettify<Omit<KVPreloadRestoreSetOptions, 'engines' | 'ttl'> & { storeIn: string[]; ttl: TTLKVOptions }>;
            warmup: Prettify<RequiredStrict<Omit<KVPreloadWarmupSetOptions, 'ttl'>> & { ttl: TTLKVOptions }>
        }
    }
}

// =======================================================================
// Set configs
export type KVSetConfigs = KVNormalSetConfigs | KVPreloadSetConfigs;
export type KVPreloadSetConfigs = KVPreloadRestoreSetConfigs | KVPreloadWarmupSetConfigs;
export type KVPreloadWarmupSetConfigs = KVTypeMap['configs']['preload']['warmup'];
export type KVPreloadRestoreSetConfigs = KVTypeMap['configs']['preload']['restore'];
export type KVNormalSetConfigs = KVTypeMap['configs']['normal'];

// =======================================================================
// Set options
export type KVSetOptions = KVNormalSetOptions | KVPreloadSetOptions;
export type KVPreloadSetOptions = KVPreloadRestoreSetOptions | KVPreloadWarmupSetOptions;
export type KVPreloadWarmupSetOptions = KVTypeMap['options']['preload']['warmup'];
export type KVPreloadRestoreSetOptions = KVTypeMap['options']['preload']['restore'];
export type KVNormalSetOptions = KVTypeMap['options']['normal'];

export type KVCacheRecordExportedData = Exclude<Awaited<ReturnType<KVCacheRecord['export']>>, undefined>;

export type KVCacheController = {
    get: (key: string, scope: string) => KVCacheRecord | undefined;
    update: (record: KVCacheRecord, value: unknown, session?: CacheSession) => Promise<void>;
    set: (key: string, value: unknown, options?: KVSetOptions, session?: CacheSession) => Promise<void>;
    read: <T = unknown>(key: string, scope: string, session?: CacheSession) => Promise<T | undefined>;
    remove: (key: string, scope: string, session?: CacheSession) => Promise<boolean>;
}