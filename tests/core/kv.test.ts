import cachify from "../../src/cachify";
import kvEventsManager from "../../src/core/events/managers/kv/KVEventsManager";
import { RedisClientType, createClient } from "@redis/client";
import { cleanup } from "../helpers/helpers";

const cache = {
    redisClient: undefined as unknown as RedisClientType
}

const mainHandlers = {
    async beforeEach() {
        cachify.kv.configs.ttl.value = 0;
        await cachify.clear(); // Ensure a clean slate before each test
    },

    async afterAll() {
        await Promise.all([
            cachify.clear(),
            cleanup()
        ])
    }
}

const redisHandlers = {
    async beforeAll() {
        cache.redisClient = createClient({ url: process.env.REDIS_TEST_URL! });
        cachify.engines.useRedis('redis', cache.redisClient);
        await cache.redisClient.connect();
        await cache.redisClient.flushDb('ASYNC');
    },
    async afterAll() {
        await mainHandlers.afterAll();
        if (cache.redisClient?.isOpen) { await cache.redisClient.quit() }
    }
}

describe('KVCacheManager - Clear Operations', () => {
    beforeEach(async () => {
        await mainHandlers.beforeEach();
    });
    afterAll(async () => {
        await mainHandlers.afterAll();
    });

    it("should expire KV record after TTL", async () => {
        await cachify.kv.set("expiring", "bye", { ttl: 500 }); // 0.5 sec

        await new Promise(res => setTimeout(res, 600));

        const val = await cachify.kv.get("expiring");
        expect(val).toBeUndefined(); // expired
    });

    it('should clear all records across all scopes', async () => {
        await Promise.all([
            cachify.kv.set('a', 1),
            cachify.kv.set('b', 2, { scope: 'user' }),
            cachify.kv.set('c', 3, { scope: 'admin' }),
        ])

        expect(cachify.kv.size).toBe(3);

        await cachify.clear();

        expect(cachify.kv.size).toBe(0);
        expect(await cachify.kv.get('a')).toBeUndefined();
        expect(await cachify.kv.get('b', 'user')).toBeUndefined();
        expect(await cachify.kv.get('c', 'admin')).toBeUndefined();
    });

    it('should clear only the specified scope', async () => {
        await Promise.all([
            cachify.kv.set('x', 'X'),
            cachify.kv.set('y', 'Y', { scope: 'session' })
        ])

        expect(cachify.kv.size).toBe(2);

        await cachify.clear('session');

        expect(await cachify.kv.get('x')).toBe('X');
        expect(await cachify.kv.get('y', 'session')).toBeUndefined();
        expect(cachify.kv.size).toBe(1);
    });

    it('should emit `clear` (via `remove`) for each record', async () => {
        const clearedKeys: string[] = [];

        kvEventsManager.on('remove', (event) => {
            clearedKeys.push(event.item.key);
            if (clearedKeys.length === 2) {
                expect(clearedKeys).toEqual(expect.arrayContaining(['foo', 'bar']));
            }
        });

        await Promise.all([
            cachify.kv.set('foo', 123),
            cachify.kv.set('bar', 456)
        ])

        await cachify.clear();
    });

    it('should throw if provided scope is not a string', async () => {
        // @ts-expect-error
        await expect(cachify.clear(123)).rejects.toThrow(TypeError);
    });

    it('should throw if provided scope is an empty string', async () => {
        await expect(cachify.clear('')).rejects.toThrow(RangeError);
    });

    if (process.env.REDIS_TEST_URL) {
        describe('Redis adapter', () => {
            beforeAll(async () => await redisHandlers.beforeAll());
            afterAll(async () => await redisHandlers.afterAll());

            it('should clear all records across all scopes', async () => {
                await Promise.all([
                    cachify.kv.set('a', 1, { storeIn: ['redis'] }),
                    cachify.kv.set('b', 2, { scope: 'user', storeIn: ['redis'] }),
                    cachify.kv.set('c', 3, { scope: 'admin', storeIn: ['redis'] }),
                ])

                expect(cachify.kv.size).toBe(3);

                cachify.clear();

                expect(cachify.kv.size).toBe(0);
                expect(await cachify.kv.get('a')).toBeUndefined();
                expect(await cachify.kv.get('b', 'user')).toBeUndefined();
                expect(await cachify.kv.get('c', 'admin')).toBeUndefined();
            });

            it('should set and read a record', async () => {
                await cachify.kv.set('a', 1, { storeIn: ['redis'] });
                expect(await cachify.kv.get('a')).toBe(1);
            });
        });
    }
});