import { TTLExpirationHandler } from "./TTLConfig";
import atomix from "@nasriya/atomix";

class TTLItemConfig {
    #_data = {
        value: 300_000,
        onExpire: undefined as TTLExpirationHandler | undefined,
        sliding: true
    }

    constructor(options: { value: number, onExpire?: TTLExpirationHandler, sliding?: boolean }) {
        this.#_data.value = options.value;
        if (typeof options.onExpire === 'function') { this.#_data.onExpire = options.onExpire }
        if (typeof options.sliding === 'boolean') { this.#_data.sliding = options.sliding }
    }

    /**
     * Retrieves whether or not the TTL is sliding for the cache item.
     * When the TTL is sliding, it will be updated every time the record is accessed.
     * @returns {boolean} Whether or not the TTL is sliding for the cache item.
     * @since v1.1.0
     */
    get sliding(): boolean { return this.#_data.sliding }

    /**
     * Sets whether or not the TTL is sliding for the cache item.
     * When the TTL is sliding, it will be updated every time the record is accessed.
     * @param {boolean} sliding Whether or not the TTL is sliding for the cache item.
     * @throws {TypeError} If the provided sliding value is not a boolean.
     * @since v1.1.0
     */
    set sliding(sliding: boolean) {
        if (typeof sliding !== 'boolean') { throw new TypeError(`The provided sliding value (${sliding}) is not a boolean.`) }
        this.#_data.sliding = sliding
    }

    /**
     * Retrieves the time-to-live (TTL) value for the cache item.
     * @returns {number} The TTL value in milliseconds.
     */
    get value(): number { return this.#_data.value }

    /**
     * Sets the time-to-live (TTL) value for the cache item.
     * @param {number} ttl The TTL value in milliseconds.
     * @throws {TypeError} If the provided ttl is not a number.
     * @throws {TypeError} If the provided ttl is not an integer.
     * @throws {RangeError} If the provided ttl is less than 0.
     */
    set value(ttl: number) {
        if (!atomix.valueIs.number(ttl)) { throw new TypeError(`The provided ttl (${ttl}) is not a number.`) }
        if (!atomix.valueIs.integer(ttl)) { throw new TypeError(`The provided ttl (${ttl}) is not an integer.`) }
        if (ttl < 0) { throw new RangeError(`The provided ttl (${ttl}) must be greater than or equal to 0.`) }
        this.#_data.value = ttl;
    }

    /**
     * Retrieves the event handler to call when the TTL expires for the cache item.
     * @returns {(TTLExpirationHandler | undefined)} The event handler to call when the TTL expires for the cache item.
     */
    get onExpire(): TTLExpirationHandler | undefined { return this.#_data.onExpire }

    /**
     * Sets the event handler to call when the TTL expires for the cache item.
     * The event handler will be called with the cache item as the only argument.
     * If the handler is set to `undefined`, the expiration action will be determined by the cache's configuration.
     * @param {TTLExpirationHandler | undefined} handler The event handler to call when the TTL expires for the cache item.
     * @throws {TypeError} If the provided handler is not a function.
     */
    set onExpire(handler: TTLExpirationHandler | undefined) {
        if (handler === undefined) { this.#_data.onExpire = undefined; return }
        if (typeof handler !== 'function') { throw new TypeError(`The provided handler (${handler}) is not a function.`) }
        this.#_data.onExpire = handler;
    }
}

export default TTLItemConfig;