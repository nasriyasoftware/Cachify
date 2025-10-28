import cachify from "../../cachify";
import atomix from "@nasriya/atomix";
import constants from "../consts/consts";
import PersistenceManager from "./persistence.manager";
import type { CacheFlavor } from "../docs/docs";
import type { ProxyBackupParameters, ProxyRestoreParameters, StorageServices } from "./docs";

class PersistenceProxy {
    readonly #_manager: PersistenceManager;

    constructor(manager: PersistenceManager) { this.#_manager = manager }
    
    readonly #_helpers = {
        validate: {
            backupData: (data: unknown) => {
                if (!atomix.valueIs.record(data)) { throw new TypeError(`The "data" argument must be a record, but instead got ${typeof data}`) }

                if (atomix.dataTypes.record.hasOwnProperty(data, 'source')) {
                    const source = data.source;
                    if (!atomix.valueIs.string(source)) { throw new TypeError(`The "initiator" property of the "data" object must be a string, but instead got ${typeof source}`) }
                    if (!constants.CACHE_FLAVORS.includes(source as CacheFlavor)) { throw new RangeError(`The "initiator" property of the "data" object must be one of the following values: ${constants.CACHE_FLAVORS.join(', ')}`) }
                    if (!(source in cachify)) { throw new Error(`The cache flavor "${source}" is not implemented yet by cachify.`) }
                } else {
                    throw new SyntaxError(`The "initiator" property of the "data" object is required and missing.`);
                }

                if (atomix.dataTypes.record.hasOwnProperty(data, 'content')) {
                    const content = data.content;
                    if (!(content instanceof Map)) { throw new TypeError(`The "content" property of the "data" object must be a Map, but instead got ${typeof content}`) }
                } else {
                    throw new SyntaxError(`The "content" property of the "data" object is required and missing.`);
                }
            },
            service: (service: unknown) => {
                if (!atomix.valueIs.string(service)) { throw new TypeError(`The "service" argument must be a string, but instead got ${typeof service}`) }
                if (!constants.BACKUP_STORAGE_SERVICES.includes(service as StorageServices)) { throw new RangeError(`The "service" argument must be one of the following values: ${constants.BACKUP_STORAGE_SERVICES.join(', ')}`) }
            }
        }
    }

    async backup<
        F extends CacheFlavor,
        S extends StorageServices
    >(...args: ProxyBackupParameters<F, S>) {
        const [data, to, ...rest] = args;
        this.#_helpers.validate.backupData(data);
        this.#_helpers.validate.service(to);

        const driver = this.#_manager.getDriver(to);
        if (!driver) { throw new Error(`The provided storage service (${to}) is not implemented.`) }

        const backupStream = this.#_manager.createBackupStream();

        // Pass the stream to the backup() BEFORE writing data
        const backupPromise = driver.backup(
            // @ts-ignore - backup method signature is safe for the given storage type `S`
            data.source, backupStream, ...rest
        );

        const writePromise = async () => {
            for (const [scope, scopeMap] of data.content) {
                const scopeRecords = Array.from(scopeMap.values());
                const promises = scopeRecords.map(record => record.export());
                const records = await Promise.all(promises);

                for (const record of records.filter(i => atomix.valueIs.record(i))) {
                    await backupStream.writeRecord(record);
                }
            }

            await backupStream.close();
        }


        await Promise.all([backupPromise, writePromise()])
    }

    async restore<
        F extends CacheFlavor,
        S extends StorageServices
    >(...args: ProxyRestoreParameters<F, S>) {
        const [flavor, from, ...rest] = args;
        this.#_helpers.validate.service(from);

        const driver = this.#_manager.getDriver<S>(from);
        if (!driver) { throw new Error(`The provided storage service (${from}) is not implemented.`) }

        // @ts-ignore - backup method signature is safe for the given storage type `S`
        await driver.restore(flavor, ...rest);
    }
}

export default PersistenceProxy;