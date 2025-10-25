import { CacheFlavor } from "../docs/docs";
import { PersistanceStorageServices } from "../persistence/docs";

/**
 * The overhead for each object in the cache in bytes.
 * @constant
 * @since 1.0.0
 */
export const OBJECT_OVERHEAD = 24 as const;

/**
 * The list of backup storage services that are supported by cachify.
 * @constant
 * @since 1.0.0
 */
export const BACKUP_STORAGE_SERVICES: (keyof PersistanceStorageServices)[] = ['local', 's3', /*'gcs', 'azure', 'ftp', 'sftp', 'redis'*/] as const;

/**
 * The block size for the stream cipher in bytes.
 * **Value**: `1_048_576` = 1 MB;
 * @constant
 * @since 1.0.0
 */
export const STREAM_CIPHER_BLOCK_SIZE = 1_048_576 as const;

/**
 * The IV size for the stream cipher in bytes.
 * **Value**: `16` = 16 bytes;
 * @constant
 * @since 1.0.0
 */
export const STREAM_CIPHER_IV_SIZE = 16 as const;

/**
 * The list of `preload` initiators that are supported by cachify.
 * @constant
 * @since 1.0.0
 */
export const CACHE_PRELOAD_INITIATORS = ['warmup', 'restore'] as const;

/**
 * The list of cache flavors that are supported by cachify.
 * @constant
 * @since 1.0.0
 */
export const CACHE_FLAVORS: CacheFlavor[] = ['kvs', 'files', /*'database'*/] as const;

const constants = {
    OBJECT_OVERHEAD,
    BACKUP_STORAGE_SERVICES,
    STREAM_CIPHER_BLOCK_SIZE,
    STREAM_CIPHER_IV_SIZE,
    CACHE_PRELOAD_INITIATORS,
    CACHE_FLAVORS,
} as const;

export default constants;