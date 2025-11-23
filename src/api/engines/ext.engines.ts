import atomix from "@nasriya/atomix";
import Engines from "../../core/engines/Engines";
import type { CacheRecord } from "../../core/docs/docs";
import type { StorageEngineHandlers } from "../../core/engines/docs";
import type { RedisClientType } from '@redis/client';

class ExtEngines {
    readonly #_id = `${Date.now()}_${Math.floor(Math.random() * 100)}`;
    readonly #_engines: Engines;
    constructor(engines: Engines) { this.#_engines = engines; }

    readonly #_helpers = {
        isRedisClient(client: any): client is RedisClientType {
            return (
                typeof client === 'object' &&
                client !== null &&
                typeof (client as any).connect === 'function' &&
                typeof (client as any).isOpen === 'boolean'
            );
        }
    }

    /**
     * Defines a new external storage engine with the given name and handlers.
     * 
     * @param name - The name of the engine to define.
     * @param handlers - An object with the methods "onSet", "onRead", and "onRemove" implemented.
     * @returns The name of the newly defined engine.
     * @throws TypeError If the arguments are invalid.
     * @throws SyntaxError If the handlers argument is missing one of the required methods.
     * @throws Error If an engine with the given name already exists.
     * @since v1.0.0
     */
    defineEngine<StorageEntry extends { key: string;[x: string]: any }>(
        name: string,
        handlers: StorageEngineHandlers<StorageEntry>
    ): string {
        return this.#_engines.defineEngine(name, handlers);
    }

    /**
     * Configures a Redis-based storage engine with the specified name and client.
     * 
     * @param name - The name of the engine to define.
     * @param client - The Redis client instance to be used for the engine.
     * @param options - Optional configuration settings for the engine.
     * @param options.prefix - An optional prefix to be applied to all keys used by this engine.
     * @since v1.0.0
     * 
     * The Redis client is automatically connected if it is not already open.
     * If a prefix is provided, it is prepended to record keys when performing operations.
     */
    useRedis(name: string, client: RedisClientType, options?: { prefix?: string }): string {
        try {
            const configs = {
                prefix: undefined as string | undefined,
            }

            {
                // validate the name argument
                if (!atomix.valueIs.string(name)) { throw new TypeError(`The "name" argument must be a string, but instead got ${typeof name}`) }
                if (name.length === 0) { throw new RangeError(`The "name" argument must not be an empty string`) }
                if (this.#_engines.preservedNames.includes(name as any)) { throw new Error(`The engine name "${name}" is reserved and cannot be used.`); }
                if (this.#_engines.hasEngine(name)) { throw new Error(`An engine with the name "${name}" is already defined.`); }

                // validate the client argument
                if (!this.#_helpers.isRedisClient(client)) { throw new TypeError(`The "client" argument must be a Redis client instance, but instead got ${typeof client}`) }

                // validate the options argument
                if (atomix.valueIs.record(options)) {
                    if (atomix.dataTypes.record.hasOwnProperty(options, 'prefix')) {
                        if (!atomix.valueIs.string(options.prefix)) { throw new TypeError(`The "options.prefix" argument (when provided) must be a string, but instead got ${typeof options.prefix}`) }
                        if (options.prefix.length === 0) { throw new RangeError(`The "options.prefix" argument (when provided) must not be an empty string`) }
                        configs.prefix = options.prefix.replace(/:$/, ''); // Ensure prefix does not end with a colon
                    }
                }
            }

            const connect = async () => {
                if (client.isOpen) { return; }
                await client.connect();
            }

            const getKey = (record: CacheRecord) => {
                const base = `${record.flavor}/${record.scope}/${record.key}`;
                return `${configs.prefix ?? 'cachify'}:client_${this.#_id}:${base}`;
            }

            return this.#_engines.defineEngine(name, {
                onSet: async (record, value) => {
                    await connect();
                    const key = getKey(record);

                    if (record.flavor === 'files' && Buffer.isBuffer(value)) {
                        await client.set(key, value);
                    } else {
                        const buffer = atomix.http.bodyCodec.encode(value);
                        await client.set(key, buffer);
                    }
                },
                onRead: async (record) => {
                    await connect();
                    const key = getKey(record);

                    if (record.flavor === 'files') {
                        const buffer = await client.sendCommand<Buffer>(['GET', key]);
                        return buffer === null ? undefined : buffer;
                    } else {
                        const stringifiedBuffer = await client.get(key);
                        if (stringifiedBuffer === null) { return undefined; }
                        const buffer = Buffer.from(stringifiedBuffer, 'utf-8');
                        return atomix.http.bodyCodec.decode(buffer);
                    }
                },
                onRemove: async (record) => {
                    await connect();
                    await client.del(getKey(record));
                }
            })
        } catch (error) {
            if (error instanceof Error) { error.message = `Failed to define Redis engine "${name}": ${error.message}`; }
            throw error;
        }
    }
}

export default ExtEngines;