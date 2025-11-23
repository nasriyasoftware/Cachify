import overwatch from '@nasriya/overwatch';
import cachify from '../';
import { cleanup } from '../helpers/helpers';
import redisClient from '../setup/jest.redis';

describe("Cachify Isolation Integration", () => {
    const clients = {
        a: cachify.createClient(),
        b: cachify.createClient(),
    };

    beforeAll(() => {
        overwatch.control.resume();

        for (const client of Object.values(clients)) {
            client.engines.useRedis('redis', redisClient)
        }
    });

    afterAll(async () => {
        await cleanup(Object.values(clients));
    });

    it("isolates in-memory cache between clients", async () => {
        await clients.a.kvs.set("foo", "bar");

        const res = await Promise.all([
            cachify.kvs.read("foo"),    // global
            clients.a.kvs.read("foo"),  // client a
            clients.b.kvs.read("foo"),  // client b
        ]);

        expect(res).toEqual([undefined, "bar", undefined]);
    });

    it("isolates Redis scopes between clients", async () => {
        await clients.a.kvs.set("rkey", "valueA", { storeIn: 'redis' });
        await clients.b.kvs.set("rkey", "valueB", { storeIn: 'redis' });

        const [a, b] = await Promise.all([
            clients.a.kvs.read("rkey"),
            clients.b.kvs.read("rkey"),
        ]);

        expect(a).not.toBe(b);
    });
});
