import cachify from '..';
import { cleanup } from '../helpers/helpers';

import path from 'path';
import fs from 'fs';

import atomix from '@nasriya/atomix';
import uuidX from '@nasriya/uuidx';
import overwatch from '@nasriya/overwatch';

import configs from '../configs';
import redisClient from '../setup/jest.redis';
import { CachifyClient } from '../../src';

describe('Cachify Lifecycle Integration', () => {
    const testFile = path.join(configs.testDir, 'update.txt');
    const clients: Record<string, CachifyClient> = {};

    beforeAll(async () => {
        overwatch.control.pause();
        overwatch.detectionInterval = 200;

        // Create a temp directory for tests
        await fs.promises.mkdir(configs.testDir, { recursive: true });
        await fs.promises.writeFile(testFile, 'initial content');

        overwatch.control.resume();
    });

    afterAll(async () => {
        // Clean up temp directory
        await Promise.all([
            fs.promises.rm(configs.testDir, { recursive: true, force: true }),
            cleanup(Object.values(clients))
        ]);
    });

    afterEach(async () => {
        // Clear the cache after each test
        await cachify.clear();
    });

    const createClient = () => {
        const client = clients[uuidX.v4()] = cachify.createClient();
        client.engines.useRedis('redis', redisClient);
        return client;
    }

    //
    // ──────────────────────────── KVS LIFECYCLE ────────────────────────────
    //
    describe('KVS lifecycle', () => {
        it('sets and retrieves values correctly', async () => {
            await cachify.kvs.set('user:1', { name: 'Ahmad' });
            const result = await cachify.kvs.read('user:1');
            expect(result).toEqual({ name: 'Ahmad' });
        });

        it('handles Redis-backed KVS records correctly', async () => {
            await cachify.kvs.set('user:2', { name: 'Omar' }, { storeIn: 'redis' });
            const result = await cachify.kvs.read('user:2');
            expect(result).toEqual({ name: 'Omar' });
        });

        it('evicts expired KVS records (default policy)', async () => {
            const client = createClient();

            client.kvs.configs.ttl.policy = 'evict';

            await client.kvs.set('temp', 'data', { ttl: { value: 120 } });
            expect(await client.kvs.read('temp')).toBe('data');

            await atomix.utils.sleep(180);

            const read = await client.kvs.read('temp');
            expect(read).toBeUndefined();
        });

        it('removes records explicitly and clears state', async () => {
            const id = uuidX.v4();
            await cachify.kvs.set(id, 'toRemove');
            expect(await cachify.kvs.read(id)).toBe('toRemove');

            await cachify.kvs.remove(id);
            expect(await cachify.kvs.read(id)).toBeUndefined();

            await cachify.kvs.set('persist', 'value');
            await cachify.clear();
            expect(await cachify.kvs.read('persist')).toBeUndefined();
        });
    });

    //
    // ──────────────────────────── FILES LIFECYCLE ────────────────────────────
    //
    describe('Files lifecycle', () => {
        it('caches and reads files correctly', async () => {
            await cachify.files.set(testFile);

            const firstInspect = cachify.files.inspect({ filePath: testFile })!;
            expect(firstInspect.file.isCached).toBe(false);

            const firstRead = await cachify.files.read({ filePath: testFile });
            expect(firstRead!.status).toBe('miss');
            expect(firstRead!.content.toString()).toBe('initial content');

            const secondInspect = cachify.files.inspect({ filePath: testFile })!;
            expect(secondInspect.file.isCached).toBe(true);

            const secondRead = await cachify.files.read({ filePath: testFile });
            expect(secondRead!.status).toBe('hit');
            expect(secondRead!.content.toString()).toBe('initial content');
        });

        it('removes files explicitly', async () => {
            await cachify.files.set(testFile);
            await cachify.files.remove({ filePath: testFile });

            const inspect = cachify.files.inspect({ filePath: testFile });
            expect(inspect).toBeUndefined();
        });

        it('keeps metadata but evicts content when TTL policy = keep', async () => {
            const client = createClient();
            client.files.configs.ttl.policy = 'keep';

            await client.files.set(testFile, {
                ttl: { value: 150 },
                preload: true,
                initiator: 'warmup'
            });

            const initialInspect = client.files.inspect({ filePath: testFile })!;
            expect(initialInspect.file.isCached).toBe(true);

            await atomix.utils.sleep(180);

            const afterInspect = client.files.inspect({ filePath: testFile });
            expect(afterInspect).toBeDefined();
            expect(afterInspect!.file.isCached).toBe(false);

            const read = await client.files.read({ filePath: testFile });
            expect(read!.status).toBe('miss');
            expect(read!.content.toString()).toBe('initial content');
        });

        it('fully evicts file record when TTL policy = evict', async () => {
            const client = createClient();
            client.files.configs.ttl.policy = 'evict';

            await client.files.set(testFile, {
                ttl: { value: 100 },
                preload: true,
                initiator: 'warmup'
            });

            const inspect1 = client.files.inspect({ filePath: testFile });
            expect(inspect1).toBeDefined();

            await atomix.utils.sleep(150);

            const inspect2 = client.files.inspect({ filePath: testFile });
            expect(inspect2).toBeUndefined();

            const read = await client.files.read({ filePath: testFile });
            expect(read).toBeUndefined();
        });

        it('updates keys upon file rename while keeping metadata', async () => {
            const originalInterval = overwatch.detectionInterval;
            overwatch.detectionInterval = 200;

            try {
                const originalPath = path.join(configs.testDir, 'original_file.txt');
                const renamedPath = path.join(configs.testDir, 'renamed_file.txt');

                await fs.promises.writeFile(originalPath, 'initial content');
                await cachify.files.set(originalPath, { preload: true, initiator: 'warmup' });

                await fs.promises.rename(originalPath, renamedPath);
                await atomix.utils.sleep(250);

                const originalInspect = cachify.files.inspect({ filePath: originalPath });
                expect(originalInspect).toBeUndefined();

                const inspect = cachify.files.inspect({ filePath: renamedPath });
                expect(inspect).toBeDefined();

                const read = await cachify.files.read({ filePath: renamedPath });
                expect(read!.status).toBe('hit');
                expect(read!.content.toString()).toBe('initial content');
            } finally {
                overwatch.detectionInterval = originalInterval;
            }
        });
    });

    //
    // ──────────────────────────── MIXED OPERATIONS ────────────────────────────
    //
    describe('Mixed operations', () => {
        it('handles both flavors consistently across clients', async () => {
            const clientA = createClient();
            const clientB = createClient();

            await clientA.kvs.set('sharedKey', 'A-value');
            await clientB.kvs.set('sharedKey', 'B-value');

            // Each client’s memory is isolated
            const [aRead, bRead, globalRead] = await Promise.all([
                clientA.kvs.read('sharedKey'),
                clientB.kvs.read('sharedKey'),
                cachify.kvs.read('sharedKey')
            ]);

            expect(aRead).toBe('A-value');
            expect(bRead).toBe('B-value');
            expect(globalRead).toBeUndefined();

            // Redis isolation: each client’s namespace prevents conflicts
            await clientA.kvs.set('redisKey', 'RA', { storeIn: 'redis' });
            await clientB.kvs.set('redisKey', 'RB', { storeIn: 'redis' });

            const [aRedis, bRedis] = await Promise.all([
                clientA.kvs.read('redisKey'),
                clientB.kvs.read('redisKey')
            ]);

            expect(aRedis).toBe('RA');
            expect(bRedis).toBe('RB');
        });
    });
})