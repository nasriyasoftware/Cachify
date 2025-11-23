import atomix from "@nasriya/atomix";
import StorageEngine from "./StorageEngine";

import { MemoryStorageEntry, StorageEngineHandlers } from "./docs";

class Engines {
    readonly #_engines: Map<string, StorageEngine<any>> = new Map();
    readonly #_preservedNames = Object.freeze(['memory'] as const);

    constructor() {
        // Register the default memory engine
        this.defineEngine<MemoryStorageEntry>('memory', {
            onSet: async (record, value, context) => {
                const start = performance.now();
                context!.set(record.key, value);
                const end = performance.now();
                if (end - start > 10) {
                    console.warn(`[WARN] Slow SET: ${(end - start).toFixed(2)}ms`);
                }
            },
            onRead: async (record, context): Promise<any> => {
                return context!.get(record.key);
            },
            onRemove: async (record, context): Promise<void> => {
                if (context!.has(record.key)) { context!.delete(record.key) }
            }
        });
    }

    /**
     * Defines a new storage engine with the given name and handlers.
     * 
     * @param name - The name of the engine to define.
     * @param handlers - An object with the methods "onSet", "onRead", and "onRemove" implemented.
     * @returns The name of the newly defined engine.
     * @throws TypeError If the arguments are invalid.
     * @throws SyntaxError If the handlers argument is missing one of the required methods.
     * @throws Error If an engine with the given name already exists.
     * @since v1.0.0
     */
    defineEngine<StorageEntry extends { [x: string]: any }>(
        name: string,
        handlers: StorageEngineHandlers<StorageEntry>
    ): string {
        try {
            if (!atomix.valueIs.string(name)) { throw new TypeError(`The "name" argument must be a string, but instead got ${typeof name}`) }
            if (name.length === 0) { throw new RangeError(`The "name" argument must not be an empty string`) }
            if (this.#_engines.has(name)) { throw new Error(`An engine with the name "${name}" is already defined.`); }

            if (!atomix.valueIs.record(handlers)) { throw new TypeError(`The "handlers" argument must be an object literal, but instead got ${typeof handlers}`) }

            const hasOwnProp = atomix.dataTypes.record.hasOwnProperty;

            if (hasOwnProp(handlers, "onSet")) {
                if (typeof handlers.onSet !== "function") { throw new TypeError(`The "handlers.onSet" method must be a function, but instead got ${typeof handlers.onSet}`) }
                if (handlers.onSet.length < 2) { throw new TypeError(`The "handlers.onSet" method must accept at least two arguments: "record", "value", and "context".`) }
            } else {
                throw new SyntaxError(`The "handlers" argument must be an object with the "onSet" method defined.`);
            }

            if (hasOwnProp(handlers, "onRead")) {
                if (typeof handlers.onRead !== "function") { throw new TypeError(`The "handlers.onRead" method must be a function, but instead got ${typeof handlers.onRead}`) }
                if (handlers.onRead.length < 1) { throw new TypeError(`The "handlers.onRead" method must accept at least one argument: "record".`) }
            } else {
                throw new SyntaxError(`The "handlers" argument must be an object with the "onRead" method defined.`);
            }

            if (hasOwnProp(handlers, "onRemove")) {
                if (typeof handlers.onRemove !== "function") { throw new TypeError(`The "handlers.onRemove" method must be a function, but instead got ${typeof handlers.onRemove}`) }
                if (handlers.onRemove.length < 1) { throw new TypeError(`The "handlers.onRemove" method must accept at least one argument: "record".`) }
            } else {
                throw new SyntaxError(`The "handlers" argument must be an object with the "onRemove" method defined.`);
            }

            const engine = new StorageEngine<StorageEntry>(name, {
                onSet: handlers.onSet,
                onRead: handlers.onRead,
                onRemove: handlers.onRemove
            });

            this.#_engines.set(name, engine);
            return name;
        } catch (error) {
            if (error instanceof Error) { error.message = `Failed to define engine "${name}": ${error.message}`; }
            throw error;
        }
    }

    /**
     * Returns a list of the names of the engines that are preserved.
     * @see {@link defineEngine} for more information on preserved engines.
     * @returns An array of strings, each being the name of a preserved engine.
     * @since v1.0.0
     */
    get preservedNames() {
        return this.#_preservedNames;
    }

    /**
     * Retrieves the engine with the given name.
     * @param name - The name of the engine to retrieve.
     * @returns The engine with the given name, or undefined if no engine with the given name exists.
     * @throws TypeError If the "name" argument is not a string.
     * @throws RangeError If the "name" argument is an empty string.
     * @example
     * const manager = new StorageEnginesManager();
     * const engine = manager.getEngine('memory');
     * if (engine) {
     *     const record = { key: 'myKey', flavor: 'myFlavor', scope: 'myScope' };
     *     engine.set(record, 'myValue');
     *     console.log(engine.get(record));
     * } else {
     *     console.log('Engine not found');
     * }
     * @since v1.0.0
     */
    getEngine<StorageEntry extends { key: string;[x: string]: any }>(name: string): StorageEngine<StorageEntry> | undefined {
        return this.#_engines.get(name) as StorageEngine<StorageEntry> | undefined;
    }

    /**
     * Checks if an engine with the given name exists.
     * @param name - The name of the engine to check for.
     * @returns A boolean indicating whether an engine with the given name exists.
     * @throws TypeError If the "name" argument is not a string.
     * @throws RangeError If the "name" argument is an empty string.
     * @example
     * const manager = new StorageEnginesManager();
     * const engine = manager.hasEngine('memory');
     * if (engine) {
     *     console.log('Engine exists');
     * } else {
     *     console.log('Engine does not exist');
     * }
     * @since v1.0.0
     */
    hasEngine(name: string): boolean {
        return this.#_engines.has(name);
    }
}

export default Engines;