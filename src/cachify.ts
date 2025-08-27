import { AddHandlerOptions } from "@nasriya/atomix";
import engines from "./engines/engines";
import FileCacheManager from "./core/memory/files/manager";
import KVCacheManager from "./core/memory/kv/manager";
import eventsBroker from "./core/events/broker/EventsBroker";
import externalPersistenceManager from "./persistence/external.persistence.manager";

class Cachify {
    readonly #_managers = {
        kv: new KVCacheManager,
        files: new FileCacheManager
    }

    /**
     * Clears the cache for the specified scope or for all scopes if no scope is provided.
     * 
     * This method delegates the clearing operation to the `clear` method of all cache managers.
     * 
     * @param {string} [scope] - The scope for which to clear the cache. If not provided, clears all scopes.
     * @since v1.0.0
     */
    async clear(scope?: string) {
        // Call the `clear` method of all cache managers
        await Promise.all([
            this.#_managers.kv.clear(scope),
            this.#_managers.files.clear(scope),
            /**
             * TODO: Once other cache managers are implemented,
             * call the `clear` method of each cache manager
             */
        ]);
    }

    /**
     * Access the key-value cache manager.
     * @returns {KVCacheManager}
     * @since v1.0.0
     */
    get kv(): KVCacheManager { return this.#_managers.kv }

    /**
     * Access the file cache manager.
     * @returns {FileCacheManager}
     * @since v1.0.0
     */
    get files(): FileCacheManager { return this.#_managers.files }

    /**
     * Retrieves the current debug mode status for the cache system.
     * 
     * @returns {boolean} `true` if the debug mode is enabled, `false` otherwise.
     * @since v1.0.0
     */
    get debug(): boolean {
        return process.env.CACHIFY_DEBUG === 'true'
    }

    /**
     * Sets the debug mode for the cache system.
     * 
     * If the value is `true`, the cache system will log additional information about its operations.
     * If the value is `false`, the cache system will not log any additional information.
     * 
     * @param {boolean} value - The value to set the debug mode to.
     * @throws {TypeError} Throws if the provided value is not a boolean.
     * @since v1.0.0
     */
    set debug(value: boolean) {
        if (typeof value !== 'boolean') { throw new TypeError('The provided value must be a boolean.') }
        process.env.CACHIFY_DEBUG = value ? 'true' : 'false'
    }

    /**
     * Retrieves the events broker for the cache system.
     * 
     * The events broker is used to emit and listen to cache-related events.
     * 
     * @since v1.0.0
     */
    get events() { return eventsBroker }

    /**
     * Access the engines manager.
     * 
     * The engines manager is used to configure and access the engines
     * used by the cache system to store records.
     * 
     * @since v1.0.0
     */
    get engines() { return engines }

    /**
     * 
     * @since v1.0.0
     */
    get persistence() { return externalPersistenceManager }
}

const cachify = new Cachify();
export default cachify;