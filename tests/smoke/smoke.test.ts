import path from 'path';
import fs from 'fs';
import cachify from '../';
import { cleanup } from '../helpers/helpers';
import configs from '../configs';
import overwatch from '@nasriya/overwatch';
import atomix from '@nasriya/atomix';
import uuidX from '@nasriya/uuidx';

const testFilePath = path.join(configs.testDir, 'integration-test.txt');
const localBackupName = 'local-backup-test';
const s3BackupName = 's3-backup-test';

describe('Cachify Full Lifecycle Integration', () => {
    const clients: Record<string, typeof cachify> = {};

    beforeAll(async () => {
        overwatch.control.resume();

        if (!fs.existsSync(configs.testDir)) {
            await fs.promises.mkdir(configs.testDir, { recursive: true });
        }
        await fs.promises.writeFile(testFilePath, 'Persistence test content');

        // Setup persistence backends
        cachify.persistence.use('local', { path: configs.testDir });
        if (
            process.env.S3_TEST_BUCKET &&
            process.env.S3_TEST_REGION &&
            process.env.S3_TEST_KEY &&
            process.env.S3_TEST_SECRET
        ) {
            cachify.persistence.use('s3', {
                bucket: process.env.S3_TEST_BUCKET!,
                region: process.env.S3_TEST_REGION!,
                credentials: {
                    accessKeyId: process.env.S3_TEST_KEY!,
                    secretAccessKey: process.env.S3_TEST_SECRET!
                }
            });
        }
    });

    afterAll(async () => {
        await cleanup(Object.values(clients));
        await fs.promises.rm(testFilePath);
    });

    beforeEach(async () => {
        await cachify.clear();
    });

    // ------------------------
    // KVS Tests
    // ------------------------
    describe('KVS operations', () => {
        it('sets, gets, and removes records', async () => {
            const key = 'user:' + uuidX.v4();
            await cachify.kvs.set(key, { name: 'Ahmad' });
            expect(await cachify.kvs.read(key)).toEqual({ name: 'Ahmad' });

            await cachify.kvs.remove(key);
            expect(await cachify.kvs.read(key)).toBeUndefined();
        });

        it('respects TTL and evicts after expiration', async () => {
            const key = 'ttl-key';
            cachify.kvs.configs.ttl.policy = 'evict';
            await cachify.kvs.set(key, 'value', { ttl: { value: 100 } });
            await atomix.utils.sleep(150);
            expect(await cachify.kvs.read(key)).toBeUndefined();
        });
    });

    // ------------------------
    // File operations
    // ------------------------
    describe('File cache operations', () => {
        it('sets and reads file with hit/miss behavior', async () => {
            await cachify.files.set(testFilePath, { preload: true, initiator: 'warmup' });

            // First read triggers miss (content already preloaded, so may be hit)
            const read1 = await cachify.files.read({ filePath: testFilePath });
            expect(read1).toBeDefined();
            expect(['hit', 'miss']).toContain(read1!.status);
            expect(read1!.content.toString()).toBe('Persistence test content');

            // Second read should always be hit
            const read2 = await cachify.files.read({ filePath: testFilePath });
            expect(read2!.status).toBe('hit');
        });

        it('removes file cache correctly', async () => {
            await cachify.files.set(testFilePath, { preload: true, initiator: 'warmup' });
            await cachify.files.remove({ filePath: testFilePath });
            expect(cachify.files.inspect({ filePath: testFilePath })).toBeUndefined();
        });

        it('evicts expired file with TTL', async () => {
            cachify.files.configs.ttl.policy = 'evict';

            await cachify.files.set(testFilePath, { ttl: { value: 100 }, preload: true, initiator: 'warmup' });

            // Wait for TTL to expire
            await atomix.utils.sleep(150);

            // The record should be completely removed
            const record = cachify.files.inspect({ filePath: testFilePath });
            expect(record).toBeUndefined();

            // Reading should trigger a miss
            const read = await cachify.files.read({ filePath: testFilePath });
            expect(read).toBeUndefined();
        });

    });

    // ------------------------
    // Persistence (local + S3)
    // ------------------------
    describe('Persistence integration', () => {
        it('backs up and restores KVS locally', async () => {
            await cachify.kvs.set('user:1', { name: 'Ahmad' });
            await cachify.persistence.backup('local', localBackupName);

            await cachify.clear();
            expect(await cachify.kvs.read('user:1')).toBeUndefined();

            await cachify.persistence.restore('local', localBackupName);
            const restored = await cachify.kvs.read('user:1');
            expect(restored).toEqual({ name: 'Ahmad' });
        });

        it('backs up and restores file metadata locally (content loads on first read)', async () => {
            await cachify.files.set(testFilePath, { preload: true, initiator: 'warmup' });
            await cachify.persistence.backup('local', localBackupName);

            await cachify.clear();
            expect(cachify.files.inspect({ filePath: testFilePath })).toBeUndefined();

            await cachify.persistence.restore('local', localBackupName);
            const restoredMeta = cachify.files.inspect({ filePath: testFilePath });
            expect(restoredMeta).toBeDefined();
            expect(restoredMeta!.file.isCached).toBe(false);

            const read = await cachify.files.read({ filePath: testFilePath });
            expect(read!.status).toBe('miss');
            expect(read!.content.toString()).toBe('Persistence test content');

            const read2 = await cachify.files.read({ filePath: testFilePath });
            expect(read2!.status).toBe('hit');
        });

        if (process.env.S3_TEST_BUCKET) {
            it('backs up and restores KVS to/from S3', async () => {
                await cachify.kvs.set('user:2', { name: 'Omar' });
                await cachify.persistence.backup('s3', s3BackupName);

                await cachify.clear();
                expect(await cachify.kvs.read('user:2')).toBeUndefined();

                await cachify.persistence.restore('s3', s3BackupName);
                expect(await cachify.kvs.read('user:2')).toEqual({ name: 'Omar' });
            });

            it('backs up and restores file metadata to/from S3', async () => {
                await cachify.files.set(testFilePath, { preload: true, initiator: 'warmup' });
                await cachify.persistence.backup('s3', s3BackupName);

                await cachify.clear();
                const restoredMeta = cachify.files.inspect({ filePath: testFilePath });
                expect(restoredMeta).toBeDefined();
                expect(restoredMeta!.file.isCached).toBe(false);

                const read = await cachify.files.read({ filePath: testFilePath });
                expect(read!.status).toBe('miss');
                expect(read!.content.toString()).toBe('Persistence test content');
            });
        }
    });

    // ------------------------
    // Lifecycle / update (files)
    // ------------------------
    describe('File update lifecycle', () => {
        it('updates cached content when file changes on disk', async () => {
            await cachify.files.set(testFilePath, { preload: true, initiator: 'warmup' });
            const watcher = await overwatch.watchFile(testFilePath);

            const updatedContent = 'Updated content';
            const updateEvent = new Promise(resolve => {
                watcher.onUpdate(event => {
                    setTimeout(() => resolve(event), 50);
                });
            });

            await fs.promises.writeFile(testFilePath, updatedContent);

            const event = await updateEvent;
            expect((event as any).path).toBe(testFilePath.toLowerCase());

            const read = await cachify.files.read({ filePath: testFilePath });
            expect(read!.content.toString()).toBe(updatedContent);
        });
    });
});
