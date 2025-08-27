import atomix, { DeepReadonly } from "@nasriya/atomix";
import { PersistanceStorageServices, StorageServices } from "./docs";

type BackupFunction<S extends StorageServices> = PersistanceStorageServices[S]['api']['private']['backup'];
type RestoreFunction<S extends StorageServices> = PersistanceStorageServices[S]['api']['private']['restore'];
type Configs<S extends StorageServices> = PersistanceStorageServices[S]['configs'];

abstract class PersistanceService<S extends StorageServices> {
    readonly #_service: S;
    readonly #_configs: DeepReadonly<Configs<S>>;

    constructor(service: S, configs: Configs<S>) {
        const clone = atomix.dataTypes.object.smartClone.bind(atomix.dataTypes.object);
        const deepFreeze = atomix.dataTypes.record.deepFreeze.bind(atomix.dataTypes.record);

        this.#_service = service;
        this.#_configs = deepFreeze(clone(configs));
    }

    /**
     * Retrieves the type of storage service associated with this persistence service.
     *
     * @returns {S} The service type.
     */
    get service(): S { return this.#_service }

    /**
     * The configuration options for the persistence service, as set by the user when creating the service.
     * @readonly
     * @type {DeepReadonly<Configs<S>>}
     */
    get configs() { return this.#_configs }

    abstract backup(...args: Parameters<BackupFunction<S>>): ReturnType<BackupFunction<S>>;

    abstract restore(...args: Parameters<RestoreFunction<S>>): ReturnType<RestoreFunction<S>>;
}

export default PersistanceService;