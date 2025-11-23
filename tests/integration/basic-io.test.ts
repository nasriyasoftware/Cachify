import cachify from '../';
import { cleanup } from '../helpers/helpers';

import atomix from '@nasriya/atomix';
import overwatch from '@nasriya/overwatch';
import uuidX from '@nasriya/uuidx';

import path from 'path';
import fs from 'fs';

import configs from '../configs';
import { CachifyClient } from '../../src';

describe('Cachify I/O Integration', () => {
    const testFilePath = path.join(configs.testDir, 'test.txt');
    const clients: Record<string, CachifyClient> = {};

    beforeAll(async () => {
        overwatch.control.resume();
        if (!fs.existsSync(configs.testDir)) {
            await fs.promises.mkdir(configs.testDir, { recursive: true });
        }
        await fs.promises.writeFile(testFilePath, 'test content');
    });

    afterAll(async () => {
        await cleanup(Object.values(clients));
        await fs.promises.rm(testFilePath);
    });

    beforeEach(async () => {
        await cachify.clear();
    });

    // -------------------------------
    // KVS Operations
    // -------------------------------
    describe('KVS Operations', () => {
        it('stores and retrieves simple key/value pairs (memory)', async () => {
            await cachify.kvs.set("user:1", { name: "Ahmad" });
            const read = await cachify.kvs.read("user:1");
            expect(read).toEqual({ name: "Ahmad" });
        });

        it('stores and retrieves key/value pairs in Redis', async () => {
            await cachify.kvs.set('2', { name: 'Omar' }, { scope: 'users', storeIn: 'redis' });
            const read = await cachify.kvs.read('2', 'users');
            expect(read).toEqual({ name: 'Omar' });
        });

        it('removes records correctly from both memory and Redis', async () => {
            const id = uuidX.v4();

            // Memory
            await cachify.kvs.set(id, { name: "Ahmad" }, { scope: 'users' });
            expect(await cachify.kvs.read(id, 'users')).toEqual({ name: "Ahmad" });
            await cachify.kvs.remove(id, 'users');
            expect(await cachify.kvs.read(id, 'users')).toBeUndefined();

            await cachify.clear();

            // Redis
            await cachify.kvs.set('foo', 'bar', { storeIn: 'redis' });
            expect(await cachify.kvs.read('foo')).toEqual('bar');
            await cachify.kvs.remove('foo');
            expect(await cachify.kvs.read('foo')).toBeUndefined();
        });
    });

    // -------------------------------
    // File Operations
    // -------------------------------
    describe('File Operations', () => {
        it('caches and reads files correctly (memory)', async () => {
            await cachify.files.set(testFilePath);

            const inspectBefore = cachify.files.inspect({ filePath: testFilePath })!;
            expect(inspectBefore.file.isCached).toBe(false);

            const read1 = await cachify.files.read({ filePath: testFilePath });
            expect(read1!.status).toBe('miss');
            expect(read1!.content.toString()).toBe('test content');

            const inspectAfter = cachify.files.inspect({ filePath: testFilePath })!;
            expect(inspectAfter.file.isCached).toBe(true);

            const read2 = await cachify.files.read({ filePath: testFilePath });
            expect(read2!.status).toBe('hit');
        });

        it('caches and reads files correctly (Redis)', async () => {
            await cachify.files.set(testFilePath, { storeIn: ['redis'], preload: true, initiator: 'warmup' });

            const inspect = cachify.files.inspect({ filePath: testFilePath })!;
            expect(inspect.file.isCached).toBe(true);

            const read = await cachify.files.read({ filePath: testFilePath });
            expect(read!.status).toBe('hit');
            expect(read!.content.toString()).toBe('test content');
        });

        it('removes cached files and validates state transitions', async () => {
            await cachify.files.set(testFilePath);

            const inspect1 = cachify.files.inspect({ filePath: testFilePath })!;
            expect(inspect1.file.isCached).toBe(false);

            await cachify.files.remove({ filePath: testFilePath });
            expect(cachify.files.inspect({ filePath: testFilePath })).toBeUndefined();
        });

        it('respects TTL and cache invalidation policies', async () => {
            const client = clients.removePolicy = cachify.createClient();
            client.files.configs.ttl.policy = 'keep';

            await client.files.set(testFilePath, { ttl: { value: 200 }, preload: true, initiator: 'warmup' });

            const inspect1 = client.files.inspect({ filePath: testFilePath })!;
            expect(inspect1.file.isCached).toBe(true);

            await atomix.utils.sleep(220);

            const inspect2 = client.files.inspect({ filePath: testFilePath })!;
            expect(inspect2.file.isCached).toBe(false);

            const read = await client.files.read({ filePath: testFilePath });
            expect(read!.status).toBe('miss');
        });
    });
});