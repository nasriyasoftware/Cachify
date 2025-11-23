import atomix from '@nasriya/atomix';
import cachify from '../../../../cachify';
import KVCacheRecord from '../../../flavors/kvs/kvs.record';
import { EvictReason } from '../../docs';
import { AddHandlerOptions, EventEmitter } from '@nasriya/atomix/tools';
import { KVBulkRemoveEvent, KVCacheEvent, KVCacheEvents, KVCachePayload, KVCreateEvent, KVReadEvent, KVRemovalReason, KVRemoveEvent, KVTouchEvent, KVUpdateEvent } from './docs';

export class KVsEventsManager {
    readonly #_eventEmitter: EventEmitter;

    constructor() {
        const eventsEmitter = this.#_eventEmitter = new EventEmitter();
        eventsEmitter.maxHandlers = Infinity;
        eventsEmitter.on('*', (event) => {
            if (cachify.debug) {
                console.group(event.type || 'Unknown', 'Event');
                console.debug(event, { colors: true, depth: Infinity });
                console.groupEnd();
            }
        })
    }

    /**
     * Emits an event with the specified payload, and also emits the event on the wildcard event handler.
     * @param {E} event - The name of the event to emit.
     * @param {KVCacheEvents[E]['payload']} payload - The payload to be emitted with the event.
     * @since v1.0.0
     */
    async #_emit<E extends KVCacheEvent>(event: E, payload: KVCacheEvents[E]['payload']): Promise<void> {
        await this.#_eventEmitter.emit(event, payload);
    }

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
    on<E extends KVCacheEvent>(event: E, handler: (payload: KVCacheEvents[E]['payload']) => void, options?: AddHandlerOptions): void {
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
     * Registers a handler that will be executed for all key-value cache events.
     * 
     * @param {(event: KVCachePayload) => void} handler - The function to be executed when any event is emitted.
     * @returns {void}
     * @since v1.0.0
     */
    onAny(handler: (event: KVCachePayload) => void): void {
        this.#_eventEmitter.on('*', handler);
    }

    /**
     * Removes a previously registered handler for a specific key-value cache event or all events.
     * 
     * @template K - The type of the key-value cache event or 'Any' to indicate all events.
     * @param {K} event - The event to remove the handler for. If set to 'Any', removes the handler for all events.
     * @param {(payload: K extends KVCacheEvent ? KVCacheEvents[K]['payload'] : KVCachePayload) => void} handler - The function to be removed.
     * @returns {void}
     * @since v1.0.0
     */
    removeHandler<K extends KVCacheEvent | 'Any'>(
        event: K,
        handler: K extends KVCacheEvent ? (payload: KVCacheEvents[K]['payload']) => void : (event: KVCachePayload) => void
    ): void {
        this.#_eventEmitter.remove.handler(event === 'Any' ? '*' : event, handler);
    }

    readonly emit = {
        /**
         * Emits the 'evict' event when a record is evicted from the cache due to various reasons.
         * @param {KVCacheRecord} record - The record that was evicted from the cache.
         * @param {{ reason: EvictReason }} options - An object containing the reason for the eviction.
         * @since v1.0.0
         */
        evict: async (record: KVCacheRecord, options: { reason: EvictReason }) => {
            await this.emit.remove(record, { reason: options.reason });
        },


        /**
         * Emits the 'expire' event when a record expires from the key-value cache.
         * A record is considered expired if it has a TTL greater than 0 and the expiration date is in the past.
         * If the record has a TTL of 0, it is never considered expired.
         * @param {KVCacheRecord} record - The record that expired from the cache.
         * @since v1.0.0
         */
        expire: async (record: KVCacheRecord) => {
            await this.emit.remove(record, { reason: 'expire' });
        },

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
        remove: async (record: KVCacheRecord, options: { reason: KVRemovalReason } = { reason: 'manual' }) => {
            const removalReason: KVRemovalReason = options?.reason || 'manual';
            const payload: KVRemoveEvent = { item: record.toJSON(), flavor: record.flavor, type: 'remove', reason: removalReason };
            await this.#_emit('remove', payload);
        },

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
        bulkRemove: async (records: KVCacheRecord[], options: { reason: KVRemovalReason } = { reason: 'manual' }) => {
            const removalReason: KVRemovalReason = options?.reason || 'manual';
            const payload: KVBulkRemoveEvent = {
                items: records.map(record => record.toJSON()),
                flavor: records[0].flavor,
                type: 'bulkRemove',
                reason: removalReason
            }

            await this.#_emit('bulkRemove', payload);
        },

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
        create: async (record: KVCacheRecord, options: { preload?: boolean } = { preload: false }) => {
            const payload: KVCreateEvent = { item: record.toJSON(), flavor: record.flavor, type: 'create', preload: options.preload === true };
            await this.#_emit('create', payload);
        },

        /**
         * Emits the 'read' event when a record is accessed in the key-value cache.
         * 
         * This method creates and emits a payload for the 'read' event, including the record's data.
         * 
         * @param {KVCacheRecord} record - The key-value cache record that was accessed.
         * @since v1.0.0
         */
        read: async (record: KVCacheRecord) => {
            const payload: KVReadEvent = { item: record.toJSON(), flavor: record.flavor, type: 'read' };
            await this.#_emit('read', payload);
        },


        /**
         * Emits the 'update' event when a record is updated in the key-value cache.
         * This method creates and emits a payload for the 'update' event, including the record's data.
         * @param {KVCacheRecord} record - The key-value cache record that was updated.
         * @since v1.0.0
         */
        update: async (record: KVCacheRecord) => {
            const payload: KVUpdateEvent = { item: record.toJSON(), flavor: record.flavor, type: 'update' };
            await this.#_emit('update', payload);
        },


        /**
         * Emits the 'clear' event when the entire key-value cache is being cleared.
         * This results in the removal of all entries from the cache.
         * 
         * **Note:** This event is only emitted by the cache manager.
         * @param {KVCacheRecord} record - The record associated with the clear operation.
         * @since v1.0.0
         */
        clear: async (record: KVCacheRecord) => {
            await this.emit.remove(record, { reason: 'clear' });
        },


        /**
         * Emits the 'touch' event for a record accessed in the key-value cache.
         * 
         * This method creates and emits a payload for the 'touch' event, including the record's data.
         * It is used to update the record's metadata, such as LRU, without modifying the value.
         * 
         * @param {KVCacheRecord} record - The key-value cache record that was accessed.
         * @since v1.0.0
         */
        touch: async (record: KVCacheRecord) => {
            const payload: KVTouchEvent = { item: record.toJSON(), flavor: record.flavor, type: 'touch' };
            await this.#_emit('touch', payload);
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

export default KVsEventsManager;