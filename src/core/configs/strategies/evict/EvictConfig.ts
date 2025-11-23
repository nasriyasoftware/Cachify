import atomix from "@nasriya/atomix";
import { CacheStatusChangeHandler } from "../docs";

export type EvictionMode = 'lru' | 'fifo' | 'lfu';
export interface EvictOptions {
    enabled?: boolean;
    maxRecords?: number;
    mode?: EvictionMode;
}

class EvictConfig {
    readonly #_updateStatus: CacheStatusChangeHandler;
    readonly #_data = {
        enabled: true,
        /** Default max items before oldest gets evicted */
        maxRecords: 500,
        mode: 'lru' as EvictionMode
    }

    constructor(updateStatus: CacheStatusChangeHandler, options?: EvictOptions) {
        this.#_updateStatus = updateStatus;

        if (options && atomix.valueIs.record(options)) {
            if (atomix.dataTypes.record.hasOwnProperty(options, 'enabled')) { this.enabled = options.enabled! }
            if (atomix.dataTypes.record.hasOwnProperty(options, 'maxRecords')) { this.maxRecords = options.maxRecords! }
            if (atomix.dataTypes.record.hasOwnProperty(options, 'mode')) { this.mode = options.mode! }
        }
    }

    /**
     * Retrieves whether or not the eviction policy is enabled for the cache.
     * When disabled, the cache will not evict items, and the cache will grow indefinitely.
     * @returns {boolean} Whether or not the eviction policy is enabled for the cache.
     */
    get enabled(): boolean { return this.#_data.enabled }

    /**
     * Sets whether or not the eviction policy is enabled for the cache.
     * When disabled, the cache will not evict items, and the cache will grow indefinitely.
     * @param {boolean} enabled Whether or not the eviction policy is enabled for the cache.
     * @throws {TypeError} If the provided enabled value is not a boolean.
     */
    set enabled(value: boolean) {
        if (typeof value !== 'boolean') { throw new TypeError(`The provided enabled value (${value}) is not a boolean.`) }
        if (this.#_data.enabled !== value) {
            this.#_data.enabled = value;
            this.#_updateStatus('eviction', value ? 'enabled' : 'disabled');
        }
    }

    /**
     * Retrieves the maximum number of records that the cache can store before
     * the oldest record is evicted.
     * @returns {number} The maximum number of records in the cache.
     */
    get maxRecords(): number { return this.#_data.maxRecords }


    /**
     * Sets the maximum number of records that the cache can store before
     * the oldest record is evicted.
     * @param {number} maxRecords The maximum number of records in the cache. Must be a number greater than 0.
     * @throws {TypeError} If the provided maxRecords value is not a number.
     * @throws {TypeError} If the provided maxRecords value is not an integer.
     * @throws {RangeError} If the provided maxRecords value is not greater than 0.
     */
    set maxRecords(maxRecords: number) {
        if (!atomix.valueIs.number(maxRecords)) { throw new TypeError(`The provided maxRecords value (${maxRecords}) is not a number.`) }
        if (maxRecords !== Infinity) {
            if (!atomix.valueIs.integer(maxRecords)) { throw new TypeError(`The provided maxRecords value (${maxRecords}) is not an integer.`) }
            if (maxRecords <= 0) { throw new RangeError(`The provided maxRecords value (${maxRecords}) must be greater than 0.`) }
        }

        this.#_data.maxRecords = maxRecords;
    }

    /**
     * Retrieves the eviction mode of the cache.
     * The eviction mode determines which record is evicted from the cache when the cache is full and a new record is added.
     * The two valid values for this property are 'lru' and 'fifo'.
     * @returns {EvictionMode} The eviction mode of the cache.
     */
    get mode(): EvictionMode { return this.#_data.mode }

    /**
     * Sets the eviction mode of the cache.
     * The eviction mode determines which record is evicted from the cache when the cache is full and a new record is added.
     * @param {EvictionMode} mode The eviction mode of the cache. Must be a string.
     * @throws {TypeError} If the provided mode value is not a string.
     * @throws {TypeError} If the provided mode value is not a valid eviction mode.
     */
    set mode(mode: EvictionMode) {
        if (typeof mode !== 'string') { throw new TypeError(`The provided mode value (${mode}) is not a string.`) }
        mode = mode.toLowerCase() as EvictionMode;
        if (!['lru', 'fifo', 'lfu'].includes(mode)) { throw new TypeError(`The provided mode value (${mode}) is not a valid eviction mode.`) }
        this.#_data.mode = mode;
    }
}

export default EvictConfig;