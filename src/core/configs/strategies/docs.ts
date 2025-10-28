import type { CacheFlavor, CacheRecord } from "../../docs/docs";

export type CacheStatusChangeHandler = (cache: 'ttl' | 'eviction' | 'idle', status: 'enabled' | 'disabled') => void;

export type TTLExpirationHandler = (record: CacheRecord) => void;
export type TTLExpirationPolicy = 'evict' | 'refresh' | 'keep';

export type FlavorPolicyMap = {
    kvs: Extract<TTLExpirationPolicy, 'evict'>;              // kvs records can't use any policy
    files: Extract<TTLExpirationPolicy, 'evict' | 'keep'>;   // files supports only evict/keep
    database: TTLExpirationPolicy;                           // full support (example)
};

export interface BaseTTLOptions<F extends CacheFlavor> {
    enabled?: boolean;
    /** The time-to-live (TTL) value in milliseconds. */
    value: number;
    /**
     * Indicates whether the TTL should be reset when the record is accessed.
     * If `sliding` is `true`, the record's TTL will be reset to the current time when it is accessed.
     */
    sliding?: boolean;
    /** The policy to use when a record in the cache reaches its TTL. Defaults to `evict`. */
    policy?: FlavorPolicyMap[F];
    /** A handler that will be called when a record in the cache reaches its TTL. */
    onExpire?: TTLExpirationHandler;
}

export type TTLKVOptions = BaseTTLOptions<'kvs'>;
export type TTLFileOptions = BaseTTLOptions<'files'>;
// export type TTLDatabaseOptions = BaseTTLOptions<'database'>;
export type TTLOptions = TTLKVOptions | TTLFileOptions //| TTLDatabaseOptions;