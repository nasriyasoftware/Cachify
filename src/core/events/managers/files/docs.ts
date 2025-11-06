import FileCacheRecord from "../../../flavors/files/files.record";
import { Prettify } from "@nasriya/atomix";
import { CacheEvent, CacheEvents, CreateEvent, DirectRemovalSource, EvictReason, ReadEvent, RemovalReason, RemoveEvent, UpdateEvent, TouchEvent, HitEvent, MissEvent, FilesInvalidateReason, BulkRemoveEvent } from "../../docs";

export type FileCacheEvent = Extract<CacheEvent<FileCacheRecord>, 'create' | 'read' | 'update' | 'clear' | 'evict' | 'expire' | 'hit' | 'miss' | 'touch' | 'invalidate' | 'remove' | 'bulkRemove' | 'fileContentSizeChange' | 'fileRenameChange'>;
export type FileCacheEvents = Pick<CacheEvents<FileCacheRecord>, FileCacheEvent>;
export type FileCachePayload = FileCacheEvents[FileCacheEvent]['payload'];
export type FileRemovalReason = Extract<RemovalReason, EvictReason | DirectRemovalSource | FilesInvalidateReason | 'expire'>;
export type FileRemoveEvent = Prettify<RemoveEvent<FileCacheRecord>>;
export type FileBulkRemoveEvent = Prettify<BulkRemoveEvent<FileCacheRecord>>;
export type FileCreateEvent = Prettify<CreateEvent<FileCacheRecord>>;
export type FileReadEvent = Prettify<ReadEvent<FileCacheRecord>>;
export type FileUpdateEvent = Prettify<UpdateEvent<FileCacheRecord>>;
export type FileTouchEvent = Prettify<TouchEvent<FileCacheRecord>>;
export type FileHitEvent = Prettify<HitEvent<FileCacheRecord>>;
export type FileMissEvent = Prettify<MissEvent<FileCacheRecord>>;