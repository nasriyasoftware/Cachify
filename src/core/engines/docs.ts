import { CacheFlavor, CacheRecord } from "../docs/docs";

export type EngineStorageRecord<E> = {
    [flavor in CacheFlavor]: Map<string, Map<string, E>>;
};

export interface StorageEngineHandlers<E> {
    onSet: (record: CacheRecord, value: any, context?: EngineStorageContext<E>) => Promise<any>;
    onRead: (record: CacheRecord, context?: EngineStorageContext<E>) => Promise<any>;
    onRemove: (record: CacheRecord, context?: EngineStorageContext<E>) => Promise<void>;
}

export interface EngineStorageContext<Entry> {
    get(key: string): Entry | undefined;
    set(key: string, entry: Entry): void;
    delete(key: string): boolean;
    has(key: string): boolean;
}

export type MemoryStorageEntry = any;