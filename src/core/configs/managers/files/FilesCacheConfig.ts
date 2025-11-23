import atomix from "@nasriya/atomix";
import CacheConfig from "../../strategies/CacheConfig";
import { CacheStatusChangeHandler } from "../../strategies/docs";

class FilesCacheConfig extends CacheConfig<'files'> {
    readonly #_limits = {
        maxFileSize: 100 * 1024 * 1024,     // 10 MB
        maxTotalSize: 1024 * 1024 * 1024,   // 1 GB
    }

    constructor(updateStatus: CacheStatusChangeHandler) {
        super(updateStatus, 'files');
    }

    /**
     * Retrieves the maximum file size allowed for the cache in bytes.
     * Files larger than this size will not be stored in the cache.
     * 
     * @returns {number} The maximum file size in bytes.
     */
    get maxFileSize(): number { return this.#_limits.maxFileSize; }

    /**
     * Sets the maximum file size allowed for the cache in bytes.
     * Files larger than this size will not be stored in the cache.
     * @param {number} value The maximum file size in bytes. Must be a number greater than 0.
     * @throws {TypeError} If the provided maxFileSize value is not a number.
     * @throws {TypeError} If the provided maxFileSize value is not an integer.
     * @throws {RangeError} If the provided maxFileSize value is not greater than 0.
     */
    set maxFileSize(value: number) {
        if (!atomix.valueIs.number(value)) { throw new TypeError(`The provided maxFileSize value (${value}) is expected to be a number, but instead recieved ${typeof value}.`) }
        if (value !== Infinity) {
            if (!atomix.valueIs.integer(value)) { throw new TypeError(`The provided maxFileSize value (${value}) is not an integer.`) }
            if (!atomix.valueIs.positiveNumber(value)) { throw new RangeError(`The provided maxFileSize value (${value}) must be greater than 0.`) }
        }
        this.#_limits.maxFileSize = value;
    }

    /**
     * Retrieves the maximum total size allowed for the cache in bytes.
     * When the total size of the cache exceeds this value, the least recently used records will be removed until the total size is below or equal to this value.
     * @returns {number} The maximum total size in bytes.
     */
    get maxTotalSize(): number { return this.#_limits.maxTotalSize; }

    /**
     * Sets the maximum total size allowed for the cache in bytes.
     * When the total size of the cache exceeds this value, the least recently used records will be removed until the total size is below or equal to this value.
     * @param {number} value The maximum total size in bytes. Must be a number greater than 0.
     * @throws {TypeError} If the provided maxTotalSize value is not a number.
     * @throws {TypeError} If the provided maxTotalSize value is not an integer.
     * @throws {RangeError} If the provided maxTotalSize value is not greater than 0.
     * @throws {RangeError} If the provided maxTotalSize value is less than the maxFileSize value.
     */
    set maxTotalSize(value: number) {
        if (!atomix.valueIs.number(value)) { throw new TypeError(`The provided maxTotalSize value (${value}) is expected to be a number, but instead recieved ${typeof value}.`) }
        if (value !== Infinity) {
            if (!atomix.valueIs.integer(value)) { throw new TypeError(`The provided maxTotalSize value (${value}) is not an integer.`) }
            if (!atomix.valueIs.positiveNumber(value)) { throw new RangeError(`The provided maxTotalSize value (${value}) must be greater than 0.`) }
        }

        if (value < this.#_limits.maxFileSize) { throw new RangeError(`The provided maxTotalSize value (${value}) must be greater than or equal to the maxFileSize value (${this.#_limits.maxFileSize}).`) }
        this.#_limits.maxTotalSize = value;
    }
}

export default FilesCacheConfig;