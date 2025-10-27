import atomix from "@nasriya/atomix";
import { BaseTTLOptions, CacheStatusChangeHandler, FlavorPolicyMap, TTLExpirationHandler } from "../docs";
import { CacheFlavor } from "../../../docs/docs";

class TTLConfig<F extends CacheFlavor> {
    readonly #_updateStatus: CacheStatusChangeHandler;
    readonly #_flavor: F;
    readonly #_data = {
        enabled: true,
        value: 300_000,
        policy: 'evict' as FlavorPolicyMap[F],
        onExpire: undefined as TTLExpirationHandler | undefined,
        sliding: true
    }

    constructor(updateStatus: CacheStatusChangeHandler, options: BaseTTLOptions<F>, flavor: F) {
        this.#_updateStatus = updateStatus;
        this.#_flavor = flavor;

        if (atomix.dataTypes.record.hasOwnProperty(options, 'value')) {
            const ttl = options.value;
            if (ttl === 0) {
                this.#_data.enabled = false;
            } else {
                this.value = ttl;
            }
        }

        if (atomix.dataTypes.record.hasOwnProperty(options, 'onExpire')) {
            this.onExpire = options.onExpire!;
        }

        if (atomix.dataTypes.record.hasOwnProperty(options, 'policy')) {
            this.policy = options.policy!;
        }

        if (atomix.dataTypes.record.hasOwnProperty(options, 'sliding')) {
            this.sliding = options.sliding!;
        }
    }

    /**
     * Retrieves whether or not the TTL is sliding for the cache.
     * When the TTL is sliding, it will be updated every time the record is accessed.
     * @returns {boolean} Whether or not the TTL is sliding for the cache.
     * @since v1.0.0
     */
    get sliding(): boolean { return this.#_data.sliding }

    /**
     * Sets whether or not the TTL is sliding for the cache.
     * When the TTL is sliding, it will be updated every time the record is accessed.
     * @param {boolean} value Whether or not the TTL is sliding for the cache.
     * @throws {TypeError} If the provided sliding value is not a boolean.
     * @since v1.0.0
     */
    set sliding(value: boolean) {
        if (typeof value !== 'boolean') { throw new TypeError(`The provided sliding value (${value}) is not a boolean.`) }
        this.#_data.sliding = value;
    }

    /**
     * Retrieves whether or not the TTL is enabled for the cache.
     * When disabled, all records will remain in the cache indefinitely.
     * @returns {boolean} Whether or not the TTL is enabled for the cache.
     * @since v1.0.0
     */
    get enabled(): boolean { return this.#_data.enabled }

    /**
     * Sets whether or not the TTL is enabled for the cache.
     * When disabled, all records will remain in the cache indefinitely.
     * @param {boolean} enabled Whether or not the TTL is enabled for the cache.
     * @throws {TypeError} If the provided enabled value is not a boolean.
     * @since v1.0.0
     */
    set enabled(value: boolean) {
        if (typeof value !== 'boolean') { throw new TypeError(`The provided enabled value (${value}) is not a boolean.`) }
        if (this.#_data.enabled !== value) {
            this.#_data.enabled = value;
            this.#_updateStatus('ttl', value ? 'enabled' : 'disabled');
        }
    }

    /**
     * Retrieves the default time-to-live (TTL) value for new records in the cache.
     * This value is used when no TTL is provided during the creation of a new record.
     * @returns {number} The default TTL value in milliseconds.
     * @since v1.0.0
     */
    get value(): number { return this.#_data.value }

    /**
     * Sets the default time-to-live (TTL) value for new records in the cache.
     * This value is used when no TTL is provided during the creation of a new record.
     * When set to a value greater than 0, the cache will automatically expire records
     * after the specified amount of milliseconds. When set to 0, the cache will disable
     * TTL expiration for all records or a specific record, depending on where it is used.
     * @param {number} ttl The default TTL value in milliseconds. Must be a non-negative integer.
     * @throws {TypeError} If the provided ttl is not a number.
     * @throws {TypeError} If the provided ttl is not an integer.
     * @throws {RangeError} If the provided ttl is less than 0.
     * @since v1.0.0
     */
    set value(ttl: number) {
        if (!atomix.valueIs.number(ttl)) { throw new TypeError(`The provided ttl (${ttl}) is not a number.`) }
        if (!atomix.valueIs.integer(ttl)) { throw new TypeError(`The provided ttl (${ttl}) is not an integer.`) }
        if (ttl < 0) { throw new RangeError(`The provided ttl (${ttl}) must be greater than or equal to 0.`) }
        this.#_data.value = ttl;
        this.enabled = ttl > 0;
    }

    /**
     * Retrieves the policy for the cache's time-to-live (TTL).
     * The policy determines the behavior of expired records.
     * @returns {FlavorPolicyMap[F]} The policy for the cache's TTL.
     * @since v1.0.0
     */
    get policy(): FlavorPolicyMap[F] { return this.#_data.policy }

    /**
     * Sets the policy for the cache's time-to-live (TTL).
     * The policy determines the behavior of expired records.
     * The following policies are available:
     * - `evict`: When a record expires, it will be removed from the cache.
     * - `keep`: When a record expires, it will remain in the cache until it is manually removed.
     * - `refresh`: When a record expires, it will be removed from the cache and reloaded from the original source.
     * @param {FlavorPolicyMap[F]} policy The policy for the cache's TTL.
     * @throws {RangeError} If the provided policy is not a valid policy.
     * @since v1.0.0
     */
    set policy(policy: FlavorPolicyMap[F]) {
        if (!atomix.valueIs.validString(policy)) { throw new TypeError(`The provided policy (${policy}) is not a valid string.`) }
        if (!['evict', 'keep', 'refresh'].includes(policy)) { throw new RangeError(`The provided policy (${policy}) is not a valid policy.`) }

        switch (this.#_flavor) {
            case 'kvs': {
                if (!['evict'].includes(policy)) { throw new SyntaxError(`The provided policy (${policy}) is not a valid ${this.#_flavor} policy.`) }
            }
                break;

            case 'files': {
                if (!['keep', 'evict'].includes(policy)) { throw new SyntaxError(`The provided policy (${policy}) is not a valid ${this.#_flavor} policy.`) }
            }
                break;

            // case 'database': {
            //     if (!['keep', 'evict', 'refresh'].includes(policy)) { throw new SyntaxError(`The provided policy (${policy}) is not a valid ${this.#_flavor} policy.`) }
            // }
            //     break;
        }

        this.#_data.policy = policy;
    }

    /**
     * Retrieves the event handler to call when a record expires from the cache.
     * If not set, the TTL expiration policy will be used.
     * @returns {(TTLExpirationHandler | undefined)} The event handler to call when a record expires from the cache.
     * @since v1.0.0
     */
    get onExpire(): TTLExpirationHandler | undefined { return this.#_data.onExpire }

    /**
     * Sets the event handler to call when a record expires from the cache.
     * If not set, the TTL expiration policy will be used.
     * @param {(TTLExpirationHandler | undefined)} handler The event handler to call when a record expires from the cache.
     * @throws {TypeError} If the provided handler is not a function.
     * @since v1.0.0
     */
    set onExpire(handler: TTLExpirationHandler | undefined) {
        if (handler === undefined) { this.#_data.onExpire = undefined; return }
        if (typeof handler !== 'function') { throw new TypeError(`The provided handler (${handler}) is not a function.`) }
        this.#_data.onExpire = handler;
    }
}

export default TTLConfig;