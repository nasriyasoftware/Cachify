import atomix from '@nasriya/atomix';
import enginesManager from '../../core/engines/manager';
import { CacheRecord } from '../../core/docs/docs';
import type { RedisClientType } from '@redis/client';

function createRedisEngine(name: string, client: RedisClientType, options?: { prefix?: string }) {
    try {
        const configs = {
            prefix: undefined as string | undefined,
        }

        {
            // validate the name argument
            if (!atomix.valueIs.string(name)) { throw new TypeError(`The "name" argument must be a string, but instead got ${typeof name}`) }
            if (name.length === 0) { throw new RangeError(`The "name" argument must not be an empty string`) }
            if (enginesManager.preservedNames.includes(name as any)) { throw new Error(`The engine name "${name}" is reserved and cannot be used.`); }
            if (enginesManager.hasEngine(name)) { throw new Error(`An engine with the name "${name}" is already defined.`); }

            // validate the client argument
            if (!isRedisClient(client)) { throw new TypeError(`The "client" argument must be a Redis client instance, but instead got ${typeof client}`) }

            // validate the options argument
            if (atomix.valueIs.record(options)) {
                if (atomix.dataTypes.record.hasOwnProperty(options, 'prefix')) {
                    if (!atomix.valueIs.string(options.prefix)) { throw new TypeError(`The "options.prefix" argument (when provided) must be a string, but instead got ${typeof options.prefix}`) }
                    if (options.prefix.length === 0) { throw new RangeError(`The "options.prefix" argument (when provided) must not be an empty string`) }
                    configs.prefix = options.prefix.replace(/:$/, ''); // Ensure prefix does not end with a colon
                }
            }
        }

        const prefix = configs.prefix ? `${configs.prefix}:` : '';
        const connect = async () => {
            if (client.isOpen) { return; }
            await client.connect();
        }

        const getKey = (record: CacheRecord) => {
            const base = `${record.flavor}/${record.scope}/${record.key}`;
            return `${prefix}${base}`;
        }

        return enginesManager.defineEngine(name, {
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
                    const stringifiedBuffer = await client.get(getKey(record));
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

export default createRedisEngine;

function isRedisClient(client: any): client is RedisClientType {
    return (
        typeof client === 'object' &&
        client !== null &&
        typeof (client as any).connect === 'function' &&
        typeof (client as any).isOpen === 'boolean'
    );
}