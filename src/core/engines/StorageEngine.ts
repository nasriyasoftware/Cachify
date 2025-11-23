import { EngineStorageContext, EngineStorageRecord, StorageEngineHandlers } from "./docs";
import { CacheRecord } from "../docs/docs";

class StorageEngine<StorageEntry> {
    readonly #_storage: EngineStorageRecord<StorageEntry> = {} as any;
    readonly #_name: string;
    readonly #_handlers: StorageEngineHandlers<StorageEntry>;

    readonly #_helpers = {
        getScopeMap: (record: CacheRecord) => {
            const flavor = record.flavor;
            const scope = record.scope;

            const flavorMap = (() => {
                if (flavor in this.#_storage) {
                    return this.#_storage[flavor];
                } else {
                    const flavorMap = new Map<string, Map<string, StorageEntry>>();
                    this.#_storage[flavor] = flavorMap;
                    return flavorMap;
                }
            })();

            const scopeMap = (() => {
                if (flavorMap.has(scope)) {
                    return flavorMap.get(scope)!;
                } else {
                    const scopedMap = new Map<string, StorageEntry>();
                    flavorMap.set(scope, scopedMap);
                    return scopedMap;
                }
            })()

            return scopeMap;
        },
        getStorageContext: (record: CacheRecord): EngineStorageContext<StorageEntry> => {
            const scopedMap = this.#_helpers.getScopeMap(record);
            const ctx: EngineStorageContext<StorageEntry> = {
                get: scopedMap.get.bind(scopedMap),
                set: scopedMap.set.bind(scopedMap),
                delete: scopedMap.delete.bind(scopedMap),
                has: scopedMap.has.bind(scopedMap),
            };
            return ctx;
        }
    }

    constructor(name: string, handlers: StorageEngineHandlers<StorageEntry>) {
        this.#_name = name;
        this.#_handlers = handlers;
    }

    get name(): string { return this.#_name }

    /**
     * Sets the value associated with the given cache record key.
     * @param record - The cache record to set the value for.
     * @param value - The value to set for the cache record.
     * @returns A promise that resolves when the value is set.
     */
    set(record: CacheRecord, value: any): Promise<any> {
        const ctx = this.#_helpers.getStorageContext(record);
        return this.#_handlers.onSet(record, value, ctx);
    }

    /**
     * Retrieves the value associated with the given cache record key.
     * @param record - The cache record to retrieve the value for.
     * @returns A promise that resolves with the value associated with the cache record.
     */
    read(record: CacheRecord): Promise<any> {
        const ctx = this.#_helpers.getStorageContext(record);
        return this.#_handlers.onRead(record, ctx);
    }

    /**
     * Removes the cache record associated with the given key.
     * @param record - The cache record to remove.
     * @returns A promise that resolves when the record is removed.
     */
    remove(record: CacheRecord): Promise<void> {
        const ctx = this.#_helpers.getStorageContext(record);
        return this.#_handlers.onRemove(record, ctx);
    }

    /**
     * Checks if the cache record associated with the given key exists.
     * @param record - The cache record to check for.
     * @returns A boolean indicating whether the record exists or not.
     */
    has(record: CacheRecord): boolean {
        const ctx = this.#_helpers.getStorageContext(record);
        return ctx ? ctx.has(record.key) : false;
    }

    get sorage() { return this.#_storage }
}

export default StorageEngine;