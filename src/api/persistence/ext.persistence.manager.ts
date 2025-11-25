import type { BackupParameters, PersistanceStorageServices, RestoreParameters, StorageServices } from "../../core/persistence/docs";
import type { CacheFlavor } from "../../core/docs/docs";
import PersistenceManager from "../../core/persistence/persistence.manager";
import constants from "../../core/consts/consts";
import helpers from "../../core/persistence/helpers/helpers";
import CachifyClient from "../../client";

class ExtPersistenceManager {
    readonly #_cache: CachifyClient;
    readonly #_persistence: PersistenceManager;

    constructor(
        persistence: PersistenceManager,
        client: CachifyClient
    ) {
        this.#_persistence = persistence;
        this.#_cache = client;
    }

    /**
     * Initiates a backup process for the specified cache flavor and storage service.
     *
     * This function dispatches the backup operation to the appropriate cache manager
     * based on the provided cache flavor. The `kvs` flavor targets the key-value cache,
     * while the `files` flavor targets the file cache.
     *
     * @template F - The cache flavor type, indicating the cache source.
     * @template S - The type of storage service to back up to.
     * @param {S} to - The target storage service for the backup.
     * @param {...BackupParameters<S>} args - Additional parameters for the backup operation.
     * @returns {Promise<void>} Resolves when the backup operation completes.
     * @throws {Error} If the specified cache flavor is unsupported.
     */
    async backup<S extends StorageServices>(to: S, ...args: BackupParameters<S>): Promise<void> {
        for (const flavor of constants.CACHE_FLAVORS) {
            const manager = this.#_cache[flavor as CacheFlavor];
            if (manager && typeof manager.backup === 'function') {
                if (manager.size === 0) { continue }
                await manager.backup(to, ...args);
            }
        }
    }

    /**
     * Initiates a restore process from the specified storage service for all cache flavors.
     *
     * This function dispatches the restore operation to the appropriate cache manager
     * based on the provided cache flavor. The `kvs` flavor targets the key-value cache,
     * while the `files` flavor targets the file cache.
     *
     * @template S - The type of storage service to restore from.
     * @param {S} service - The target storage service for the restore.
     * @param {...RestoreParameters<S>} args - Additional parameters for the restore operation.
     * @returns {Promise<void>} Resolves when the restore operation completes.
     * @throws {Error} If the specified cache flavor is unsupported.
     */
    async restore<S extends StorageServices>(service: S, ...args: RestoreParameters<S>): Promise<void> {
        for (const flavor of constants.CACHE_FLAVORS) {
            const manager = this.#_cache[flavor as CacheFlavor];
            if (manager && typeof manager.backup === 'function') {
                await manager.restore(service, ...args);
            }
        }
    }

    /**
     * Schedules a persistence operation for the specified cache flavor and storage service.
     *
     * This function is a no-op until the persistence manager is fully implemented.
     * TODO: implement scheduling
     */
    schedule() {

    }

    /**
     * Registers a persistence service with the external persistence manager.
     *
     * @template S - The type of storage service.
     * @param {S} service - The type of storage service to be added.
     * @param {PersistanceStorageServices[S]['configs']} configs - The configuration settings for the service.
     * @since v1.0.0
     */
    use<S extends StorageServices>(service: S, configs: PersistanceStorageServices[S]['configs']) {
        helpers.validateService(service, configs);
        this.#_persistence.defineAdapter(service, configs);
    }
}

export default ExtPersistenceManager;