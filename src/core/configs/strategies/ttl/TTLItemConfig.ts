import atomix from "@nasriya/atomix";
import type { CacheFlavor } from "../../../docs/docs";
import type { BaseTTLOptions, FlavorPolicyMap, TTLExpirationHandler } from "../docs";

class TTLItemConfig<F extends CacheFlavor> {
    readonly #_flavor: F;
    #_data = {
        value: 300_000,
        policy: 'evict' as FlavorPolicyMap[F],
        onExpire: undefined as TTLExpirationHandler | undefined,
        sliding: true
    }

    constructor(options: BaseTTLOptions<F>, flavor: F) {
        this.#_flavor = flavor;
        this.#_data.value = options.value;
        if (typeof options.onExpire === 'function') { this.onExpire = options.onExpire }
        if (typeof options.sliding === 'boolean') { this.sliding = options.sliding }
        if (typeof options.policy === 'string') { this.policy = options.policy }
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