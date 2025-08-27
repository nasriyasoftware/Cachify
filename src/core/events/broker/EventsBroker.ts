import { dispose, emit, on, onAny, removeHandler } from "./utils";

/**
 * A centralized broker for managing cache-related events.
 * 
 * Provides typed, flavor-specific interfaces to:
 * - Listen to individual events (`on`)
 * - Listen to all events (`onAny`)
 * - Emit events (`emit`)
 * - Remove registered handlers (`removeHandler`)
 * 
 * Supports cache flavors: `kv`, `file`, and (in future) `database`.
 *
 * @since v1.0.0
 */
class EventsBroker {
    /**
     * Registers handlers for **specific events** within a given cache flavor.
     * 
     * Each property corresponds to a cache flavor and exposes
     * methods to listen for individual events like `'create'`, `'evict'`, etc.
     * 
     * @example
     * ```ts
     * cachify.on.kv('create', (payload) => { console.log('KV created', payload); });
     * cachify.on.file('remove', (payload) => { console.log('File removed', payload); });
     * ```
     *
     * @since v1.0.0
     */
    readonly on = on;

    /**
     * Registers handlers that respond to **any event** within a cache flavor.
     * 
     * These are called for **all emitted events** of that flavor, regardless of type.
     * Ideal for logging, analytics, or global hooks.
     *
     * @example
     * ```ts
     * cachify.onAny.kvEvent((event) => {
     *   console.log(`KV event: ${event.type}`);
     * });
     * 
     * cachify.onAny.fileEvent((event) => {
     *   if (event.type === 'remove') {
     *     console.log('File cache entry removed');
     *   }
     * });
     * ```
     *
     * @since v1.0.0
     */
    readonly onAny = onAny;

    /**
     * Emits events for a specific cache flavor.
     * 
     * Each method corresponds to a known event type like `'create'`, `'touch'`, or `'evict'`.
     * Used internally by cache managers, but exposed for advanced custom use cases.
     * 
     * @example
     * ```ts
     * cachify.emit.kv.create(payload);
     * cachify.emit.file.remove(payload);
     * ```
     * 
     * ⚠️ `database` flavor is defined but not yet implemented.
     *
     * @since v1.0.0
     */
    readonly emit = emit;

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
     * cachify.on.kv('update', handler);
     * cachify.removeHandler.fromKv('update', handler); // removes it
     * 
     * const anyHandler = (event) => { ... };
     * cachify.onAny.fileEvent(anyHandler);
     * cachify.removeHandler.fromFile('Any', anyHandler); // removes any-handler
     * ```
     * 
     * ⚠️ `fromDatabase` is a placeholder and will throw if called.
     *
     * @since v1.0.0
     */
    readonly removeHandler = removeHandler;

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
    dispose() { dispose() }
}

const eventsBroker = new EventsBroker();
export default eventsBroker;