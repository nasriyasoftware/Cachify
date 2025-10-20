import EvictConfig from "./evict/EvictConfig";
import IdleConfig from "./idle/IdleConfig";
import TTLConfig from "./ttl/TTLConfig";
import { CacheStatusChangeHandler } from "./docs";
import { CacheFlavor } from "../../docs/docs";

abstract class CacheConfig<F extends CacheFlavor> {
    readonly #_ttl: TTLConfig<F>;
    readonly #_eviction: EvictConfig;
    readonly #_idle: IdleConfig;

    constructor(updateStatus: CacheStatusChangeHandler, flavor: F) {
        this.#_ttl = new TTLConfig(updateStatus, { value: 300_000 }, flavor);
        this.#_eviction = new EvictConfig(updateStatus);
        this.#_idle = new IdleConfig(updateStatus);
    }

    /**
     * Retrieves the TTL configuration for the cache.
     * The TTL configuration determines the behavior of expired records.
     * @returns {TTLConfig<F>} The TTL configuration.
    */
    get ttl(): TTLConfig<F> { return this.#_ttl }

    /**
     * Retrieves the eviction configuration for the cache.
     * The eviction configuration determines the policy for removing records
     * when the cache reaches its capacity.
     * @returns {EvictConfig} The eviction configuration.
     */
    get eviction(): EvictConfig { return this.#_eviction }

    /**
     * Retrieves the idle configuration for the cache.
     * The idle configuration determines the behavior of the cache when it is not
     * accessed for a certain amount of time.
     * @returns {IdleConfig} The idle configuration.
     */
    get idle(): IdleConfig { return this.#_idle }
}

export default CacheConfig;