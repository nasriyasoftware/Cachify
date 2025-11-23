import { PersistanceStorageServices, StorageServices } from "./docs";
import BackupStream from "./helpers/BackupStream";
import RestoreStream from "./helpers/RestoreStream";
import PersistanceService from "./PersistanceService";

// Drivers
import LocalStorageDriver from "../../api/persistence/local/local.driver";
import S3StorageDriver from "../../api/persistence/s3/s3.driver";
import CachifyClient from "../../client";

type Drivers<K extends StorageServices = StorageServices> = Map<K, PersistanceService<K>>

class PersistenceManager {
    readonly #_client: CachifyClient;
    readonly #_drivers: Drivers = new Map();

    constructor(client: CachifyClient) { this.#_client = client }

    /**
     * Adds a new adapter to the storage drivers manager.
     *
     * Initializes a persistence service instance for the specified service and configuration,
     * and registers it under the given name. If the service type does not already exist in the
     * drivers map, a new entry is created.
     *
     * @template D - The type of storage service.
     * @param {D} service - The type of storage service to be added.
     * @param {PersistanceStorageServices[D]['configs']} configs - The configuration settings for the service.
     * @since v1.0.0
     */
    defineAdapter<D extends StorageServices>(
        service: D,
        configs: PersistanceStorageServices[D]['configs'],
    ) {
        const serviceInstance = (() => {
            switch (service) {
                case 'local':
                    return new LocalStorageDriver(this, configs as PersistanceStorageServices['local']['configs']);

                case 's3':
                    return new S3StorageDriver(this, configs as PersistanceStorageServices['s3']['configs']);

                default:
                    throw new Error(`Unknown or unsupported persistence service: ${service}`);
            }
        })();

        this.#_drivers.set(service, serviceInstance);
    }

    /**
     * Retrieves the map of all registered persistence services, keyed by service type.
     *
     * @returns A map of maps, where each key is a service type (e.g. "local" or "s3"),
     * and each value is a map of adapter names to their corresponding persistence service
     * instances. The map is ordered by service type, and the inner maps are ordered by
     * adapter name.
     * @since v1.0.0
     */
    get drivers() { return this.#_drivers }

    /**
     * Retrieves a persistence service instance by its service type.
     *
     * @template S - The type of storage service.
     * @param {S} service - The type of storage service to retrieve.
     * @returns The persistence service instance associated with the given
     * service type, or `undefined` if no such service is registered.
     * @since v1.0.0
     */
    getDriver<S extends StorageServices>(service: S): PersistanceService<S> | undefined {
        const driver = this.#_drivers.get(service) as PersistanceService<S>;
        return driver;
    }

    /**
     * Creates and initializes a new persistence stream.
     *
     * This method initializes a new instance of `PersistenceStream`, writes
     * the initial persistence metadata to the stream, and returns the instance.
     * The metadata includes a version identifier and a timestamp indicating
     * the creation time of the persistence.
     *
     * @returns An initialized `PersistenceStream` instance.
     * @since v1.0.0
     */
    createBackupStream(): BackupStream {
        return new BackupStream();
    }

    /**
     *
     * This method initializes a new instance of `RestoreStream`, using the
     * associated `CachifyClient` instance to set records, and returns the
     * instance.
     *
     * @returns An initialized `RestoreStream` instance.
     * @since v1.0.0
    */
    createRestoreStream(): RestoreStream {
        return new RestoreStream(this.#_client);
    }
}

export default PersistenceManager;