import atomix from "@nasriya/atomix";
import { CacheStatusChangeHandler } from "../docs";

export interface IdleOptions {
    enabled?: boolean;
    maxIdleTime?: number;
}

class IdleConfig {
    readonly #_updateStatus: CacheStatusChangeHandler;
    readonly #_data = {
        enabled: false,
        /** Maximum idle time in milliseconds */
        maxIdleTime: 60_000 // 1 minute default
    }

    /**
     * Creates a new IdleConfig instance.
     *
     * @param {CacheStatusChangeHandler} updateStatus - A function that is called when the idle status changes.
     * @param {IdleOptions} [options] - Options for the IdleConfig.
     * @param {boolean} [options.enabled] - Whether or not the cache should idle.
     * @param {number} [options.maxIdleTime] - The maximum amount of time in milliseconds that the cache should idle.
     */
    constructor(updateStatus: CacheStatusChangeHandler, options?: IdleOptions) {
        this.#_updateStatus = updateStatus;

        if (options && atomix.valueIs.record(options)) {
            if (atomix.dataTypes.record.hasOwnProperty(options, 'enabled')) { this.enabled = options.enabled! }
            if (atomix.dataTypes.record.hasOwnProperty(options, 'maxIdleTime')) { this.maxIdleTime = options.maxIdleTime! }
        }
    }

    /**
     * Retrieves whether or not the idle timeout is enabled for the cache.
     * When disabled, the cache will not be evicted due to inactivity.
     * @returns {boolean} Whether or not the idle timeout is enabled for the cache.
     */
    get enabled(): boolean { return this.#_data.enabled }


    /**
     * Sets whether or not the idle timeout is enabled for the cache.
     * When disabled, the cache will not be evicted due to inactivity.
     * @param {boolean} enabled Whether or not the idle timeout is enabled for the cache.
     * @throws {TypeError} If the provided enabled value is not a boolean.
     */
    set enabled(value: boolean) {
        if (typeof value !== 'boolean') { throw new TypeError(`The provided enabled value (${value}) is not a boolean.`) }
        if (this.#_data.enabled !== value) {
            this.#_data.enabled = value;
            this.#_updateStatus('idle', value ? 'enabled' : 'disabled');
        }
    }

    /**
     * Retrieves the maximum idle time in milliseconds that the cache will wait before it is evicted.
     * If the cache is not accessed within this time, it will be evicted.
     * @returns {number} The maximum idle time in milliseconds.
     */
    get maxIdleTime(): number { return this.#_data.maxIdleTime }

    /**
     * Sets the maximum idle time in milliseconds that the cache will wait before it is evicted.
     * If the cache is not accessed within this time, it will be evicted.
     * @param {number} ms The maximum idle time in milliseconds. Must be a number greater than 0.
     * @throws {TypeError} If the provided maxIdleTime value is not a number.
     * @throws {TypeError} If the provided maxIdleTime value is not an integer.
     * @throws {RangeError} If the provided maxIdleTime value is not greater than 0.
     */
    set maxIdleTime(ms: number) {
        if (!atomix.valueIs.number(ms)) { throw new TypeError(`The provided maxIdleTime value (${ms}) is not a number.`) }
        if (!atomix.valueIs.integer(ms)) { throw new TypeError(`The provided maxIdleTime value (${ms}) is not an integer.`) }
        if (ms <= 0) { throw new RangeError(`The provided maxIdleTime value (${ms}) must be greater than 0.`) }
        this.#_data.maxIdleTime = ms
    }
}

export default IdleConfig;