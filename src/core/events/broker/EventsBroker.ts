import { AddHandlerOptions } from "@nasriya/atomix";
import type { EventsManagers, EvictReason } from "../docs";
import type { FileCacheEvent, FileCacheEvents, FileCachePayload, FileRemovalReason } from "../managers/files/docs";
import type { KVCacheEvent, KVCacheEvents, KVCachePayload, KVRemovalReason } from "../managers/kvs/docs";
import type { EmitMap, OnAnyMap, OnMap, RemoveHandlerMap } from "./docs";
import FileCacheRecord from "../../flavors/files/files.record";
import KVCacheRecord from "../../flavors/kvs/kvs.record";
import { RenameEvent } from "@nasriya/overwatch";

/**
 * A centralized broker for managing cache-related events.
 * 
 * Provides typed, flavor-specific interfaces to:
 * - Listen to individual events (`on`)
 * - Listen to all events (`onAny`)
 * - Emit events (`emit`)
 * - Remove registered handlers (`removeHandler`)
 * 
 * Supports cache flavors: `kvs`, `file`, and (in future) `database`.
 *
 * @since v1.0.0
 */
class EventsBroker {
    readonly #_managers: EventsManagers;

    constructor(managers: EventsManagers) { this.#_managers = managers }

    /**
     * Registers handlers for **specific events** within a given cache flavor.
     * 
     * Each property corresponds to a cache flavor and exposes
     * methods to listen for individual events like `'create'`, `'evict'`, etc.
     * 
     * @example
     * ```ts
     * cachify.on.kvs('create', (payload) => { console.log('KV created', payload); });
     * cachify.on.file('remove', (payload) => { console.log('File removed', payload); });
     * ```
     *
     * @since v1.0.0
     */
    readonly on = {
        /**
         * Registers an event handler for a specified key-value cache event.
         * 
         * @template E - The type of the key-value cache event.
         * @param {E} event - The name of the event to listen for. Must be a non-empty string.
         * @param {(payload: KVCacheEvents[E]['payload']) => void} handler - The function to be executed when the event is emitted.
         * @param {AddHandlerOptions} [options] - Optional configurations for the event handler.
         * @throws {TypeError} Throws if the event is not a string or the handler is not a function.
         * @throws {RangeError} Throws if the event is an empty string.
         * @since v1.0.0
         */
        kvs: <E extends KVCacheEvent>(event: E, handler: (payload: KVCacheEvents[E]['payload']) => void, options?: AddHandlerOptions): void => {
            this.#_managers.kvs.on(event, handler, options);
        },

        /**
         * Registers an event handler for a specified file cache event.
         * 
         * @template E - The type of the file cache event.
         * @param {E} event - The name of the event to listen for. Must be a non-empty string.
         * @param {(payload: FileCacheEvents[E]['payload']) => void} handler - The function to be executed when the event is emitted.
         * @param {AddHandlerOptions} [options] - Optional configurations for the event handler.
         * @throws {TypeError} Throws if the event is not a string or the handler is not a function.
         * @throws {RangeError} Throws if the event is an empty string.
         * @since v1.0.0
         */
        files: <E extends FileCacheEvent>(event: E, handler: (payload: FileCacheEvents[E]['payload']) => void, options?: AddHandlerOptions): void => {
            this.#_managers.files.on(event, handler, options);
        },

        /**
         * Registers an event handler for a specified database cache event.
         * 
         * **Not implemented**.
         */
        // database() {
        //     throw new Error('Not implemented.');
        // }
    } as const satisfies OnMap;

    /**
     * Registers handlers that respond to **any event** within a cache flavor.
     * 
     * These are called for **all emitted events** of that flavor, regardless of type.
     * Ideal for logging, analytics, or global hooks.
     *
     * @example
     * ```ts
     * cachify.onAny.kvsEvent((event) => {
     *   console.log(`KV event: ${event.type}`);
     * });
     * 
     * cachify.onAny.filesEvent((event) => {
     *   if (event.type === 'remove') {
     *     console.log('File cache entry removed');
     *   }
     * });
     * ```
     *
     * @since v1.0.0
     */
    readonly onAny = {
        /**
         * Registers a handler that will be executed for **any key-value cache event**.
         *
         * Useful for logging, debugging, or performing actions on all events regardless of type.
         *
         * @param handler - A function to handle every emitted KV event.
         * @example
         * ```ts
         * cachify.events.onAny.kvsEvent((event) => {
         *   console.log(`KV cache event: ${event.type}`);
         * });
         * ```
         * @since v1.0.0
         */
        kvsEvent: (handler: (event: KVCachePayload) => void) => {
            this.#_managers.kvs.onAny(handler);
        },

        /**
         * Registers a handler that will be executed for **any file cache event**.
         *
         * Like `kvsEvent`, this gives you visibility into all emitted file cache events.
         *
         * @param handler - A function to handle every emitted file event.
         * @example
         * ```ts
         * cachify.onAny.filesEvent((event) => {
         *   if (event.type === 'touch') {
         *     console.log('File cache entry was touched.');
         *   }
         * });
         * ```
         * @since v1.0.0
         */
        filesEvent: (handler: (event: FileCachePayload) => void) => {
            this.#_managers.files.onAny(handler);
        },

        /**
         * Registers a handler for all **database cache events**.
         *
         * ⚠️ Not implemented yet. Calling this will throw an error.
         *
         * @throws {Error} Always throws: "Not implemented."
         * @since v1.0.0
         */
        // databaseEvent() {
        //     throw new Error('Not implemented.');
        // }
    } as const satisfies OnAnyMap;

    /**
     * Emits events for a specific cache flavor.
     * 
     * Each method corresponds to a known event type like `'create'`, `'touch'`, or `'evict'`.
     * Used internally by cache managers, but exposed for advanced custom use cases.
     * 
     * @example
     * ```ts
     * cachify.emit.kvs.create(payload);
     * cachify.emit.file.remove(payload);
     * ```
     * 
     * ⚠️ `database` flavor is defined but not yet implemented.
     *
     * @since v1.0.0
     */
    readonly emit = {
        /**
         * Emits events related to the **key-value (KV) cache** flavor.
         * 
         * Each method under this object corresponds to a specific cache event
         * (e.g. `create`, `update`, `evict`, etc.), and is used to trigger
         * event handlers registered for that event.
         * 
         * Example:
         * ```ts
         * cachify.events.emit.kvs.create(record);
         * cachify.events.emit.kvs.evict(record, { reason: 'expired' });
         * ```
         */
        kvs: {
            /**
             * Emits the 'evict' event when a record is evicted from the cache due to various reasons.
             * @param {KVCacheRecord} record - The record that was evicted from the cache.
             * @param {{ reason: EvictReason }} options - An object containing the reason for the eviction.
             * @since v1.0.0
             */
            evict: (record: KVCacheRecord, options: { reason: EvictReason }) => this.#_managers.kvs.emit.evict(record, options),

            /**
             * Emits the 'expire' event when a record expires from the key-value cache.
             * A record is considered expired if it has a TTL greater than 0 and the expiration date is in the past.
             * If the record has a TTL of 0, it is never considered expired.
             * @param {KVCacheRecord} record - The record that expired from the cache.
             * @since v1.0.0
             */
            expire: (record: KVCacheRecord) => this.#_managers.kvs.emit.expire(record),

            /**
             * Emits the 'remove' event for a record being removed from the key-value cache.
             *
             * This method creates and emits a payload for the 'remove' event, including the record's data and the reason for removal.
             * 
             * @param {KVCacheRecord} record - The key-value cache record that is being removed.
             * @param {Object} [options] - The options for the removal event.
             * @param {KVRemovalReason} [options.reason='manual'] - The reason for the removal. Defaults to 'manual'.
             * @since v1.0.0
             */
            remove: (record: KVCacheRecord, options: { reason: KVRemovalReason } = { reason: 'manual' }) => this.#_managers.kvs.emit.remove(record, options),

            /**
             * Emits the 'bulkRemove' event for multiple records being removed from the key-value cache.
             *
             * This method creates and emits a payload for the 'bulkRemove' event, including the records' data and the reason for removal.
             * 
             * @param {KVCacheRecord[]} records - An array of key-value cache records that are being removed.
             * @param {Object} [options] - The options for the removal event.
             * @param {KVRemovalReason} [options.reason='manual'] - The reason for the removal. Defaults to 'manual'.
             * @since v1.0.0
             */
            bulkRemove: (records: KVCacheRecord[], options: { reason: KVRemovalReason } = { reason: 'manual' }) => this.#_managers.kvs.emit.bulkRemove(records, options),

            /**
             * Emits the 'create' event when a record is added to the key-value cache.
             * 
             * This method creates and emits a payload for the 'create' event, including the record's data and whether it was preloaded or not.
             * 
             * @param {KVCacheRecord} record - The key-value cache record that was added to the cache.
             * @param {Object} [options] - The options for the creation event.
             * @param {boolean} [options.preload=false] - Whether the record was preloaded, or not. Defaults to false.
             * @since v1.0.0
             */
            create: (record: KVCacheRecord, options: { preload?: boolean } = { preload: false }) => this.#_managers.kvs.emit.create(record, options),

            /**
             * Emits the 'read' event when a record is accessed in the key-value cache.
             * 
             * This method creates and emits a payload for the 'read' event, including the record's data.
             * 
             * @param {KVCacheRecord} record - The key-value cache record that was accessed.
             * @since v1.0.0
             */
            read: (record: KVCacheRecord) => this.#_managers.kvs.emit.read(record),

            /**
             * Emits the 'update' event when a record is updated in the key-value cache.
             * This method creates and emits a payload for the 'update' event, including the record's data.
             * @param {KVCacheRecord} record - The key-value cache record that was updated.
             * @since v1.0.0
             */
            update: (record: KVCacheRecord) => this.#_managers.kvs.emit.update(record),

            /**
             * Emits the 'clear' event when the entire key-value cache is being cleared.
             * This results in the removal of all entries from the cache.
             * 
             * **Note:** This event is only emitted by the cache manager.
             * @param {KVCacheRecord} record - The record associated with the clear operation.
             * @since v1.0.0
             */
            clear: (record: KVCacheRecord) => this.#_managers.kvs.emit.clear(record),

            /**
             * Emits the 'touch' event for a record accessed in the key-value cache.
             * 
             * This method creates and emits a payload for the 'touch' event, including the record's data.
             * It is used to update the record's metadata, such as LRU, without modifying the value.
             * 
             * @param {KVCacheRecord} record - The key-value cache record that was accessed.
             * @since v1.0.0
             */
            touch: (record: KVCacheRecord) => this.#_managers.kvs.emit.touch(record),
        },

        /**
         * Emits events related to the **file cache** flavor.
         * 
         * Similar to `emit.kvs`, this object exposes emitters for events
         * such as `read`, `remove`, `touch`, etc., related to file-based caching.
         * 
         * Example:
         * ```ts
         * emit.files.remove(record, { reason: 'manual' });
         * emit.files.touch(record);
         * ```
         */
        files: {
            /**
             * Emits the 'evict' event when a record is evicted from the cache due to various reasons.
             * @param {FileCacheRecord} record - The record that was evicted from the cache.
             * @param {{ reason: EvictReason }} options - An object containing the reason for the eviction.
             * @since v1.0.0
             */
            evict: (record: FileCacheRecord, options: { reason: EvictReason }) => this.#_managers.files.emit.evict(record, options),

            /**
             * Emits the 'expire' event when a record expires from the cache.
             * A record is considered expired if it has a TTL greater than 0 and the expiration date is in the past.
             * If the record has a TTL of 0, it is never considered expired.
             * @param {FileCacheRecord} record - The record that expired from the cache.
             * @since v1.0.0
             */
            expire: (record: FileCacheRecord) => this.#_managers.files.emit.expire(record),

            /**
             * Emits the 'remove' event for a record being removed from the file cache.
             *
             * This method creates and emits a payload for the 'remove' event, including the record's data and the reason for removal.
             * 
             * @param {FileCacheRecord} record - The file cache record that is being removed.
             * @param {Object} [options] - The options for the removal event.
             * @param {FileRemovalReason} [options.reason='manual'] - The reason for the removal. Defaults to 'manual'.
             * @since v1.0.0
             */
            remove: (record: FileCacheRecord, options: { reason: FileRemovalReason } = { reason: 'manual' }) => this.#_managers.files.emit.remove(record, options),

            /**
             * Emits the 'remove' event for a record being removed from the file cache.
             *
             * This method creates and emits a payload for the 'remove' event, including the record's data and the reason for removal.
             * 
             * @param {FileCacheRecord} record - The file cache record that is being removed.
             * @param {Object} [options] - The options for the removal event.
             * @param {FileRemovalReason} [options.reason='manual'] - The reason for the removal. Defaults to 'manual'.
             * @since v1.0.0
             */
            bulkRemove: (records: FileCacheRecord[], options: { reason: FileRemovalReason } = { reason: 'manual' }) => this.#_managers.files.emit.bulkRemove(records, options),

            /**
             * Emits the 'create' event when a file record is added to the file cache.
             * 
             * This method creates and emits a payload for the 'create' event, including the record's data and whether it was preloaded or not.
             * 
             * @param {FileCacheRecord} record - The file cache record that was added to the cache.
             * @param {Object} [options] - The options for the creation event.
             * @param {boolean} [options.preload=false] - Whether the record was preloaded, or not. Defaults to false.
             * @since v1.0.0
             */
            create: (record: FileCacheRecord, options: { preload?: boolean } = { preload: false }) => this.#_managers.files.emit.create(record, options),

            /**
             * Emits the 'read' event when a record is accessed in the file cache.
             * This method creates and emits a payload for the 'read' event, including the record's data and the status of the read operation.
             * @param {FileCacheRecord} record - The file cache record that was accessed.
             * @param {{ status: 'hit' | 'miss' }} options - An object containing the status of the read operation.
             * @param {'hit' | 'miss'} options.status - Whether the record was found in the cache ('hit') or not ('miss').
             * @since v1.0.0
             */
            read: (record: FileCacheRecord, options: { status: 'hit' | 'miss' }) => this.#_managers.files.emit.read(record, options),

            /**
             * Emits the 'update' event when a record is updated in the file cache.
             * This method creates and emits a payload for the 'update' event, including the record's data.
             * @param {FileCacheRecord} record - The file cache record that was updated in the cache.
             * @since v1.0.0
             */
            update: (record: FileCacheRecord) => this.#_managers.files.emit.update(record),

            /**
             * Emits the 'clear' event when the entire file cache is being cleared.
             * This results in the removal of all entries from the cache.
             * 
             * **Note:** This event is only emitted by the cache manager.
             * @param {FileCacheRecord} record - The record associated with the clear operation.
             * @since v1.0.0
             */
            clear: (record: FileCacheRecord) => this.#_managers.files.emit.clear(record),

            /**
             * Emits the 'touch' event when a record is accessed in the file cache.
             * This method creates and emits a payload for the 'touch' event, 
             * including the record's data. It is used to update the record's metadata,
             * such as last access time, without modifying the value.
             * 
             * @param {FileCacheRecord} record - The file cache record that was accessed.
             * @since v1.0.0
             */
            touch: (record: FileCacheRecord) => this.#_managers.files.emit.touch(record),

            /**
             * Emits the 'hit' event when a file record is accessed and found in the cache.
             * **Note:** This event is only emitted internally by the `read` event.
             * @param {FileCacheRecord} record - The file cache record that was accessed and found in the cache.
             * @since v1.0.0
             */
            hit: (record: FileCacheRecord) => this.#_managers.files.emit.hit(record),

            /**
             * Emits the 'miss' event when a file record is accessed and not found in the cache.
             * **Note:** This event is only emitted internally by the `read` event.
             * @param {FileCacheRecord} record - The file cache record that was accessed and not found in the cache.
             * @since v1.0.0
             */
            miss: (record: FileCacheRecord) => this.#_managers.files.emit.miss(record),

            /**
             * Emits the 'fileContentSizeChange' event when the content size of a file changes.
             * @param {FileCacheRecord} record - The file cache record that has changed.
             * @param {number} delta - The change in content size (positive for addition, negative for removal).
             * @since v1.0.0
             */
            contentSizeChange: (record: FileCacheRecord, delta: number) => this.#_managers.files.emit.contentSizeChange(record, delta),

            /**
             * Emits the 'fileRenameChange' event when a file record is renamed.
             * @param {FileCacheRecord} record - The file cache record that was renamed.
             * @param {RenameEvent} renameEvent - The rename event containing the old and new paths.
             * @since v1.0.0
             */
            fileRenameChange: (record: FileCacheRecord, renameEvent: RenameEvent) => this.#_managers.files.emit.fileRenameChange(record, renameEvent),
        },

        /**
         * Emits events for the **database cache** flavor.
         * 
         * ⚠️ This flavor is not implemented yet.
         * Calling any methods under this object will currently result in an error.
         * 
         * This key exists as a placeholder for future database caching features.
         */
        // database: {}
    } as const satisfies EmitMap;

    /**
     * Removes a previously registered event handler.
     * 
     * This includes:
     * - Handlers registered for specific events (`on`)
     * - Handlers registered for all events (`onAny`)
     *
     * @example
     * ```ts
     * const handler = (event) => { ... };
     * cachify.on.kvs('update', handler);
     * cachify.removeHandler.fromKvs('update', handler); // removes it
     * 
     * const anyHandler = (event) => { ... };
     * cachify.onAny.filesEvent(anyHandler);
     * cachify.removeHandler.fromFiles('Any', anyHandler); // removes any-handler
     * ```
     * 
     * ⚠️ `fromDatabase` is a placeholder and will throw if called.
     *
     * @since v1.0.0
     */
    readonly removeHandler = {
        /**
         * Removes a previously registered handler for a **key-value cache** event.
         *
         * You can remove a handler for a specific event (`'create'`, `'evict'`, etc.)
         * or remove a generic "any" handler by passing `'Any'` as the event name.
         *
         * @template K - A specific key-value cache event name or `'Any'`.
         * @param event - The name of the event to remove the handler for, or `'Any'`.
         * @param handler - The exact handler function to be removed.
         * Must match the function reference used in `cachify.on.kvs(...)` or `cachify.onAny.kvsEvent(...)`.
         * @example
         * ```ts
         * cachify.removeHandler.fromKvs('update', onUpdateHandler);
         * cachify.removeHandler.fromKvs('Any', onAnyHandler);
         * ```
         * @since v1.0.0
         */
        fromKvs: <K extends KVCacheEvent | 'Any'>(
            event: K,
            handler: K extends KVCacheEvent ? (payload: KVCacheEvents[K]['payload']) => void : (event: KVCachePayload) => void
        ): void => {
            this.#_managers.kvs.removeHandler(event, handler);
        },

        /**
         * Removes a previously registered handler for a **file cache** event.
         *
         * Like `fromKvs`, this supports removal of both specific event handlers and
         * global "any" handlers.
         *
         * @template K - A specific file cache event name or `'Any'`.
         * @param event - The event to remove the handler for, or `'Any'`.
         * @param handler - The handler function to remove.
         * Must match the reference used in `cachify.on.file(...)` or `cachify.onAny.filesEvent(...)`.
         * @example
         * ```ts
         * cachify.removeHandler.fromFiles('remove', handler);
         * cachify.removeHandler.fromFiles('Any', anyFileHandler);
         * ```
         * @since v1.0.0
         */
        fromFiles: <K extends FileCacheEvent | 'Any'>(
            event: K,
            handler: K extends FileCacheEvent ? (payload: FileCacheEvents[K]['payload']) => void : (event: FileCachePayload) => void
        ): void => {
            this.#_managers.files.removeHandler(event, handler);
        },

        /**
         * Removes a handler from the **database cache** flavor.
         *
         * ⚠️ Not implemented yet.
         * Currently calling this method will throw an error.
         *
         * @throws {Error} Always throws: "Not implemented."
         * @since v1.0.0
         */
        // fromDatabase() {
        //     throw new Error('Not implemented.');
        // }
    } as const satisfies RemoveHandlerMap;

    /**
     * Cleans up internal state and resources used by the events manager.
     * 
     * This includes:
     * - Canceling any pending internal timers (e.g. debounced warnings)
     * - Releasing memory references to ensure the process can exit cleanly
     * - Resetting internal state in preparation for teardown or testing
     * 
     * This method is especially useful in unit tests to prevent open handles
     * (such as `setTimeout`) from blocking Jest's process exit.
     * 
     * > Note: This does **not** remove any user-registered event handlers. If needed,
     * handlers should be removed explicitly via `removeHandler()` before calling this.
     * 
     * @example
     * afterEach(() => {
     *   cachify.events.dispose();
     * });
     * 
     * @since v1.0.0
     */
    dispose() {
        this.#_managers.kvs.dispose();
        this.#_managers.files.dispose();
    }
}

export default EventsBroker;