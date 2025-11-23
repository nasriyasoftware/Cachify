import KVCacheRecord from "../../../flavors/kvs/kvs.record";
import { Prettify } from "@nasriya/atomix";
import { CacheEvent, CacheEvents, CreateEvent, DirectRemovalSource, EvictReason, ReadEvent, RemovalReason, RemoveEvent, UpdateEvent, TouchEvent, BulkRemoveEvent } from "../../docs";

export type KVCacheEvent = Extract<CacheEvent<KVCacheRecord>, 'create' | 'read' | 'update' | 'clear' | 'evict' | 'expire' | 'touch' | 'remove' | 'bulkRemove'>;
export type KVCacheEvents = Pick<CacheEvents<KVCacheRecord>, KVCacheEvent>;
export type KVCachePayload = KVCacheEvents[KVCacheEvent]['payload'];
export type KVRemovalReason = Extract<RemovalReason, EvictReason | DirectRemovalSource | 'expire'>;
export type KVRemoveEvent = Prettify<RemoveEvent<KVCacheRecord>>;
export type KVBulkRemoveEvent = Prettify<BulkRemoveEvent<KVCacheRecord>>;
export type KVCreateEvent = Prettify<CreateEvent<KVCacheRecord>>;
export type KVReadEvent = Prettify<ReadEvent<KVCacheRecord>>;
export type KVUpdateEvent = Prettify<UpdateEvent<KVCacheRecord>>;
export type KVTouchEvent = Prettify<TouchEvent<KVCacheRecord>>;