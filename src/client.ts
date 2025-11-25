import atomix from "@nasriya/atomix";
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
    #_id: string | undefined;
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
     * Creates a new instance of the CachifyClient class, optionally with the provided ID.
     *
     * @param {string} id - The ID of the cache system to create. If not provided, a new ID will be generated.
     * @throws {Error} If the specified client ID is empty, already exists, or is not a string.
     * @since v1.0.0
     */
    constructor(id?: string) {
        if (id !== undefined) {
            try {
                if (!atomix.valueIs.string(id)) { throw new Error(`Expected a string, but instead got ${typeof id}`) }
                if (id.trim().length === 0) { throw new RangeError(`The client ID must not be an empty string`) }
                if (CachifyClient.#_ids.has(id)) { throw new Error(`Cache system with ID "${id}" already exists!`); }
            } catch (error) {
                if (error instanceof Error) { error.message = `Failed to create cache system: ${error.message}`; }
                throw error;
            }

            CachifyClient.#_ids.add(id);
            this.#_id = id.trim();
        }
    }

    /**
     * The IDs of the created cache systems.
     * @since v1.0.0
     */
    static readonly #_ids: Set<string> = new Set();

    /**
     * Retrieves the unique identifier for the cache system.
     * @since v1.0.0
     */
    get id(): string | undefined { return this.#_id }

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
     * Access the persistence manager.
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