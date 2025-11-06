import atomix from '@nasriya/atomix';
import cachify from '../../../../cachify';
import FileCacheRecord from '../../../flavors/files/files.record';
import { AddHandlerOptions, EventEmitter } from '@nasriya/atomix/tools';
import { EvictReason, FileContentSizeChangeEvent, FileRenameEvent } from '../../docs';
import { FileBulkRemoveEvent, FileCacheEvent, FileCacheEvents, FileCachePayload, FileCreateEvent, FileHitEvent, FileMissEvent, FileReadEvent, FileRemovalReason, FileRemoveEvent, FileTouchEvent, FileUpdateEvent } from './docs';
import { RenameEvent } from '@nasriya/overwatch';

export class FilesEventsManager {
    readonly #_eventEmitter: EventEmitter;

    constructor() {
        const eventsEmitter = this.#_eventEmitter = new EventEmitter();
        eventsEmitter.maxHandlers = Infinity;
        eventsEmitter.on('*', (event) => {
            if (cachify.debug) {
                console.group(event.type || 'Unknown', 'Event');
                console.dir(event, { colors: true, depth: Infinity });
                console.groupEnd();
            }
        })
    }

    /**
     * Emits a file cache event.
     * 
     * @template E - The type of the file cache event.
     * @param {E} event - The name of the event to emit. Must be a non-empty string.
     * @param {FileCacheEvents[E]['payload']} payload - The payload to be sent with the event.
     * @since v1.0.0
     */
    async #_emit<E extends FileCacheEvent>(event: E, payload: FileCacheEvents[E]['payload']): Promise<void> {
        await this.#_eventEmitter.emit(event, payload);
    }

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
    on<E extends FileCacheEvent>(event: E, handler: (payload: FileCacheEvents[E]['payload']) => void, options?: AddHandlerOptions): void {
        const configs: Required<AddHandlerOptions> = {
            once: false,
            type: 'normal',
        }

        if (!atomix.valueIs.string(event)) { throw new TypeError(`The provided event (${event}) is not a string.`) }
        if (atomix.valueIs.emptyString(event)) { throw new RangeError(`The provided event (${event}) is empty.`) }
        if (typeof handler !== 'function') { throw new TypeError(`The provided handler (${handler}) is not a function.`) }

        const isRecord = atomix.valueIs.record(options);
        if (options !== undefined && !isRecord) { throw new TypeError(`The "options" parameter (when provided) must be a record, but instead got ${typeof options}`) }
        if (isRecord) {
            if (atomix.dataTypes.record.hasOwnProperty(options, 'once')) {
                if (typeof options.once !== 'boolean') { throw new TypeError(`The "once" option must be a boolean, but instead got ${typeof options.once}`) }
                configs.once = options.once;
            }

            if (atomix.dataTypes.record.hasOwnProperty(options, 'type')) {
                if (!atomix.valueIs.string(options.type)) { throw new TypeError(`The "type" option must be a string, but instead got ${typeof options.type}`) }
                if (!['normal', 'beforeAll', 'afterAll'].includes(options.type)) { throw new RangeError(`The "type" option must be one of "normal", "beforeAll", or "afterAll", but instead got ${options.type}`) }
                configs.type = options.type;
            }
        }

        this.#_eventEmitter.on(event, handler, configs);
    }

    /**
     * Registers a handler that will be executed for all file cache events.
     * 
     * @param {(event: FileCachePayload) => void} handler - The function to be executed when any event is emitted.
     * @returns {void}
     * @since v1.0.0
     */
    onAny(handler: (event: FileCachePayload) => void): void {
        this.#_eventEmitter.on('*', handler);
    }

    /**
     * Removes a previously registered handler for a specific file cache event or all events.
     * 
     * @template K - The type of the file cache event or 'Any' to indicate all events.
     * @param {K} event - The event to remove the handler for. If set to 'Any', removes the handler for all events.
     * @param {(payload: K extends FileCacheEvent ? FileCacheEvents[K]['payload'] : FileCachePayload) => void} handler - The function to be removed.
     * @returns {void}
     * @since v1.0.0
     */
    removeHandler<K extends FileCacheEvent | 'Any'>(
        event: K,
        handler: K extends FileCacheEvent ? (payload: FileCacheEvents[K]['payload']) => void : (event: FileCachePayload) => void
    ): void {
        this.#_eventEmitter.remove.handler(event === 'Any' ? '*' : event, handler);
    }

    readonly emit = {
        /**
         * Emits the 'evict' event when a record is evicted from the cache due to various reasons.
         * @param {FileCacheRecord} record - The record that was evicted from the cache.
         * @param {{ reason: EvictReason }} options - An object containing the reason for the eviction.
         * @since v1.0.0
         */
        evict: async (record: FileCacheRecord, options: { reason: EvictReason }) => {
            await this.emit.remove(record, { reason: options.reason });
        },

        /**
         * Emits the 'expire' event when a record expires from the cache.
         * A record is considered expired if it has a TTL greater than 0 and the expiration date is in the past.
         * If the record has a TTL of 0, it is never considered expired.
         * @param {FileCacheRecord} record - The record that expired from the cache.
         * @since v1.0.0
         */
        expire: async (record: FileCacheRecord) => {
            await this.emit.remove(record, { reason: 'expire' });
        },

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
        remove: async (record: FileCacheRecord, options: { reason: FileRemovalReason } = { reason: 'manual' }) => {
            const removalReason: FileRemovalReason = options?.reason || 'manual';
            const payload: FileRemoveEvent = { item: record.toJSON(), flavor: record.flavor, type: 'remove', reason: removalReason };
            await this.#_emit('remove', payload);
        },

        /**
         * Emits the 'bulkRemove' event when multiple records are removed from the file cache.
         *
         * This method creates and emits a payload for the 'bulkRemove' event, including an array of record data and the reason for removal.
         * 
         * @param {FileCacheRecord[]} records - An array of file cache records that are being removed.
         * @param {Object} [options] - The options for the removal event.
         * @param {FileRemovalReason} [options.reason='manual'] - The reason for the removal. Defaults to 'manual'.
         * @since v1.0.0
         */
        bulkRemove: async (records: FileCacheRecord[], options: { reason: FileRemovalReason } = { reason: 'manual' }) => {
            const removalReason: FileRemovalReason = options?.reason || 'manual';
            const payload: FileBulkRemoveEvent = {
                items: records.map(record => record.toJSON()),
                flavor: records[0].flavor,
                type: 'bulkRemove',
                reason: removalReason
            }

            await this.#_emit('bulkRemove', payload);
        },


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
        create: async (record: FileCacheRecord, options: { preload?: boolean } = { preload: false }) => {
            const payload: FileCreateEvent = { item: record.toJSON(), flavor: record.flavor, type: 'create', preload: options.preload === true };
            await this.#_emit('create', payload);
        },

        /**
         * Emits the 'read' event when a record is accessed in the file cache.
         * This method creates and emits a payload for the 'read' event, including the record's data and the status of the read operation.
         * @param {FileCacheRecord} record - The file cache record that was accessed.
         * @param {{ status: 'hit' | 'miss' }} options - An object containing the status of the read operation.
         * @param {'hit' | 'miss'} options.status - Whether the record was found in the cache ('hit') or not ('miss').
         * @since v1.0.0
         */
        read: async (record: FileCacheRecord, options: { status: 'hit' | 'miss' }) => {
            const payload: FileReadEvent = { item: record.toJSON(), flavor: record.flavor, type: 'read', status: options.status };
            await this.#_emit('read', payload);
        },

        /**
         * Emits the 'update' event when a record is updated in the file cache.
         * This method creates and emits a payload for the 'update' event, including the record's data.
         * @param {FileCacheRecord} record - The file cache record that was updated in the cache.
         * @since v1.0.0
         */
        update: async (record: FileCacheRecord) => {
            const payload: FileUpdateEvent = { item: record.toJSON(), flavor: record.flavor, type: 'update' };
            await this.#_emit('update', payload);
        },

        /**
         * Emits the 'clear' event when the entire file cache is being cleared.
         * This results in the removal of all entries from the cache.
         * 
         * **Note:** This event is only emitted by the cache manager.
         * @param {FileCacheRecord} record - The record associated with the clear operation.
         * @since v1.0.0
         */
        clear: async (record: FileCacheRecord) => {
            await this.emit.remove(record, { reason: 'clear' });
        },

        /**
         * Emits the 'touch' event when a record is accessed in the file cache.
         * This method creates and emits a payload for the 'touch' event, 
         * including the record's data. It is used to update the record's metadata,
         * such as last access time, without modifying the value.
         * 
         * @param {FileCacheRecord} record - The file cache record that was accessed.
         * @since v1.0.0
         */
        touch: async (record: FileCacheRecord) => {
            const payload: FileTouchEvent = { item: record.toJSON(), flavor: record.flavor, type: 'touch' };
            await this.#_emit('touch', payload);
        },

        /**
         * Emits the 'hit' event when a file record is accessed and found in the cache.
         * **Note:** This event is only emitted internally by the `read` event.
         * @param {FileCacheRecord} record - The file cache record that was accessed and found in the cache.
         * @since v1.0.0
         */
        hit: async (record: FileCacheRecord) => {
            const payload: FileHitEvent = { item: record.toJSON(), flavor: record.flavor, type: 'hit' };
            await this.#_emit('hit', payload);
        },

        /**
         * Emits the 'miss' event when a file record is accessed and not found in the cache.
         * **Note:** This event is only emitted internally by the `read` event.
         * @param {FileCacheRecord} record - The file cache record that was accessed and not found in the cache.
         * @since v1.0.0
         */
        miss: async (record: FileCacheRecord) => {
            const payload: FileMissEvent = { item: record.toJSON(), flavor: record.flavor, type: 'miss' };
            await this.#_emit('miss', payload);
        },

        /**
         * Emits the 'fileContentSizeChange' event when the content size of a file changes.
         * @param {FileCacheRecord} record - The file cache record that has changed.
         * @param {number} delta - The change in content size (positive for addition, negative for removal).
         * @since v1.0.0
         */
        contentSizeChange: async (record: FileCacheRecord, delta: number) => {
            const payload: FileContentSizeChangeEvent = { item: record.toJSON(), flavor: record.flavor, type: 'fileContentSizeChange', delta: Number(delta) };
            await this.#_emit('fileContentSizeChange', payload);
        },

        /**
         * Emits the 'fileRenameChange' event when a file record is renamed.
         * @param {FileCacheRecord} record - The file cache record that was renamed.
         * @param {RenameEvent} renameEvent - The rename event containing the old and new paths.
         * @since v1.0.0
         */
        fileRenameChange: async (record: FileCacheRecord, renameEvent: RenameEvent) => {
            const payload: FileRenameEvent = { item: record.toJSON(), flavor: record.flavor, type: 'fileRenameChange', oldPath: renameEvent.oldPath, newPath: renameEvent.newPath };
            await this.#_emit('fileRenameChange', payload);
        }
    }

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
        this.#_eventEmitter.dispose();
    }
}

export default FilesEventsManager;