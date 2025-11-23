import atomix from "@nasriya/atomix";
import CacheConfig from "../../strategies/CacheConfig";
import { CacheStatusChangeHandler } from "../../strategies/docs";

class KVsCacheConfig extends CacheConfig<'kvs'> {
    readonly #_limits = {
        maxTotalSize: 1024 * 1024 * 1024,   // 1 GB
    }

    constructor(updateStatus: CacheStatusChangeHandler) {
        super(updateStatus, 'kvs');
    }

    /**
     * Retrieves the maximum total size allowed for the cache in bytes.
     * When the total size of the cache exceeds this value, the least recently used records will be removed until the total size is below or equal to this value.
     * @returns {number} The maximum total size in bytes.
     * @since v1.0.0
     */
    get maxTotalSize(): number { return this.#_limits.maxTotalSize; }

    /**
     * Sets the maximum total size allowed for the cache in bytes.
     * When the total size of the cache exceeds this value, the least recently used records will be removed until the total size is below or equal to this value.
     * @param {number} value The maximum total size in bytes. Must be a number greater than 0.
     * @throws {TypeError} If the provided maxTotalSize value is not a number.
     * @throws {TypeError} If the provided maxTotalSize value is not an integer.
     * @throws {RangeError} If the provided maxTotalSize value is not greater than 0.
     * @since v1.0.0
     */
    set maxTotalSize(value: number) {
        if (!atomix.valueIs.number(value)) { throw new TypeError(`The provided maxTotalSize value (${value}) is expected to be a number, but instead recieved ${typeof value}.`) }
        if (value !== Infinity) {
            if (!atomix.valueIs.integer(value)) { throw new TypeError(`The provided maxTotalSize value (${value}) is not an integer.`) }
            if (!atomix.valueIs.positiveNumber(value)) { throw new RangeError(`The provided maxTotalSize value (${value}) must be greater than 0.`) }
        }

        this.#_limits.maxTotalSize = value;
    }
}

export default KVsCacheConfig;