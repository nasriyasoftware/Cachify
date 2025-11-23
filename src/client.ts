import ExtEngines from "./api/engines/ext.engines";
import ExtPersistenceManager from "./api/persistence/ext.persistence.manager";
import Engines from "./core/engines/Engines"
import EnginesProxy from "./core/engines/EnginesProxy";
import Events from "./core/events/events";
import FilesCacheManager from "./core/flavors/files/files.manager";
import KVsCacheManager from "./core/flavors/kvs/kvs.manager";
import PersistenceManager from "./core/persistence/persistence.manager";
import PersistenceProxy from "./core/persistence/proxy";

export class CachifyClient {
    readonly #_engines = new Engines();
    readonly #_enginesProxy = new EnginesProxy(this.#_engines);
    readonly #_persistence = new PersistenceManager(this);
    readonly #_persistenceProxy = new PersistenceProxy(this.#_persistence);
    readonly #_events = new Events();

    readonly #_flavors = {
        kvs: new KVsCacheManager({
            enginesProxy: this.#_enginesProxy,
            persistenceProxy: this.#_persistenceProxy,
            eventsManager: this.#_events.for.kvs
        }),
        files: new FilesCacheManager({
            enginesProxy: this.#_enginesProxy,
            persistenceProxy: this.#_persistenceProxy,
            eventsManager: this.#_events.for.files
        })
    }

    /**
     * Access the engines manager.
     * 
     * The engines manager is used to configure and access the engines
     * used by the cache system to store records.
     * 
     * @since v1.0.0
     */
    readonly engines = new ExtEngines(this.#_engines);

    /**
     * Retrieves the events broker for the cache system.
     * 
     * The events broker is used to emit and listen to cache-related events.
     * 
     * @since v1.0.0
     */
    get events() { return this.#_events.broker }

    /**
     * Access the key-value cache manager.
     * @returns {KVCacheManager}
     * @since v1.0.0
     */
    get kvs(): KVsCacheManager { return this.#_flavors.kvs }

    /**
     * Access the file cache manager.
     * @returns {FileCacheManager}
     * @since v1.0.0
     */
    get files(): FilesCacheManager { return this.#_flavors.files }

    /**
     * 
     * @since v1.0.0
     */
    readonly persistence = new ExtPersistenceManager(this.#_persistence, this);

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
            this.#_flavors.kvs.clear(scope),
            this.#_flavors.files.clear(scope),
            /**
             * TODO: Once other cache managers are implemented,
             * call the `clear` method of each cache manager
             */
        ]);
    }
}

export default CachifyClient;