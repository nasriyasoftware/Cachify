
import { StorageEngineHandlers } from '../core/engines/docs';
import enginesManager from '../core/engines/manager';
import createRedisEngine from './redis/redis.engine';

class ExternalEngines {
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
        return enginesManager.defineEngine(name, handlers);
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
    get useRedis() {
        return createRedisEngine;
    }
}

const engines = new ExternalEngines();
export default engines;