import FileCacheRecord from "../flavors/files/files.record";
import KVCacheRecord from "../flavors/kvs/kvs.record";
import type { EvictionMode } from "../configs/strategies/evict/EvictConfig";
import type { CacheFlavor, CacheRecord, RefreshableCacheRecord } from "../docs/docs";
import type { KVRemovalReason } from "./managers/kvs/docs";
import type { FileRemovalReason } from "./managers/files/docs";

import KVsEventsManager from "./managers/kvs/KVsEventsManager";
import FilesEventsManager from "./managers/files/FilesEventsManager";

export type EventsManager = KVsEventsManager | FilesEventsManager // | databaseEventsManager // TODO: Enable when the database cache is implemented

export interface CacheEvents<T extends CacheRecord = CacheRecord> {
    create: { payload: CreateEvent<T>, type: 'create' };
    read: { payload: ReadEvent<T>, type: 'read' };
    update: { payload: UpdateEvent<T>, type: 'update' };
    clear: { payload: ClearEvent, type: 'clear' };
    evict: { payload: EvictEvent<T>, type: 'evict' };
    expire: { payload: ExpireEvent<T>, type: 'expire' };
    hit: { payload: HitEvent<T>, type: 'hit' };
    miss: { payload: MissEvent<T>, type: 'miss' };
    touch: { payload: TouchEvent<T>, type: 'touch' };
    // invalidate: { payload: InvalidateEvent<T>, type: 'invalidate' }; // NOTE: This event is emitted as part of the `remove` event
    remove: { payload: RemoveEvent<T>, type: 'remove' };
    bulkRemove: { payload: BulkRemoveEvent<T>, type: 'bulkRemove' };
    fileContentSizeChange: { payload: FileContentSizeChangeEvent, type: 'fileContentSizeChange' };
    fileRenameChange: { payload: FileRenameEvent, type: 'fileRenameChange' };
}

export type RemovalReasons<T extends CacheRecord> =
    T extends KVCacheRecord ? KVRemovalReason :
    T extends FileCacheRecord ? FileRemovalReason :
    // T extends DatabaseCacheRecord ? DatabaseRemovalReason : // TODO: Enable when the database cache is implemented
    RemovalReason;

export type CacheEvent<T extends CacheRecord = CacheRecord> = keyof CacheEvents<T>;
export type CachePayload = CacheEvents[CacheEvent]['payload'];

export type InvalidateReason = FilesInvalidateReason | DocumentsInvalidateReason;
export type FilesInvalidateReason = 'file.rename' | 'file.delete' | 'file.exceedSizeLimit';
export type DocumentsInvalidateReason = 'document.update' | 'document.delete';
export type EvictReason = EvictionMode | 'idle' | 'memory.limit';
export type DirectRemovalSource = 'manual' | 'clear';

export type RemovalReason = Exclude<(EvictReason | DirectRemovalSource | InvalidateReason | 'expire'), never>;

export type FileCacheRecordJSON = ReturnType<FileCacheRecord['toJSON']>;
export type KVCacheRecordJSON = ReturnType<KVCacheRecord['toJSON']>;
interface BaseCacheEvent<T extends CacheRecord> {
    item: ReturnType<T['toJSON']>;
    flavor: CacheFlavor;
}

interface BaseBulkCacheEvent<T extends CacheRecord> {
    items: BaseCacheEvent<T>['item'][];
    flavor: BaseCacheEvent<T>['flavor'];
}

export interface CreateEvent<T extends CacheRecord> extends BaseCacheEvent<T> {
    type: 'create';
    /** Whether or not the value was added ahead of time to prime the cache or for cache warm-up. */
    preload?: boolean;
}

export type ReadEvent<T extends CacheRecord> = BaseCacheEvent<T> & {
    type: 'read';
} & (T extends RefreshableCacheRecord ? {
    /**
     * Whether or not the value was found in the cache.
     * Available only for cache flavors that reads from external sources.
     */
    status: 'hit' | 'miss';
} : {})

export interface UpdateEvent<T extends CacheRecord> extends BaseCacheEvent<T> {
    type: 'update';
}

export interface ClearEvent {
    type: 'clear';
}

export interface EvictEvent<T extends CacheRecord> extends BaseCacheEvent<T> {
    type: 'evict';
    reason: EvictReason;
}

export interface ExpireEvent<T extends CacheRecord> extends BaseCacheEvent<T> {
    type: 'expire';
}

export interface HitEvent<T extends CacheRecord> extends BaseCacheEvent<T> {
    type: 'hit';
}

export interface MissEvent<T extends CacheRecord> extends BaseCacheEvent<T> {
    type: 'miss';
}

export interface TouchEvent<T extends CacheRecord> extends BaseCacheEvent<T> {
    type: 'touch';
}

export interface InvalidateEvent<T extends CacheRecord> extends BaseCacheEvent<T> {
    type: 'invalidate';
    reason: InvalidateReason;
    flavor: Extract<CacheFlavor, 'files' | 'database'>;
}

export interface RemoveEvent<T extends CacheRecord> extends BaseCacheEvent<T> {
    type: 'remove';
    reason: RemovalReasons<T>;
}

export interface BulkRemoveEvent<T extends CacheRecord> extends BaseBulkCacheEvent<T> {
    type: 'bulkRemove';
    reason: RemovalReasons<T>;
}

export interface FileContentSizeChangeEvent extends BaseCacheEvent<FileCacheRecord> {
    item: FileCacheRecordJSON;
    type: 'fileContentSizeChange';
    delta: number;
}

export interface FileRenameEvent extends BaseCacheEvent<FileCacheRecord> {
    item: FileCacheRecordJSON;
    type: 'fileRenameChange';
    oldPath: string;
    newPath: string;
}

export type EventsManagers = {
    kvs: KVsEventsManager;
    files: FilesEventsManager;
    // database: typeof databaseEventsManager; // TODO: Enable when the database cache is implemented
}