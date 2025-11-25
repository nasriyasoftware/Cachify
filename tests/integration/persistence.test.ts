import cachify from '..';
import configs from '../configs';
import { cleanup } from '../helpers/helpers';

import overwatch from '@nasriya/overwatch';
import path from 'path';
import fs from 'fs';

describe('Persistence Integration (Global cachify)', () => {
    const backupPath = path.join(configs.testDir);
    const testFile = path.join(configs.testDir, 'update.txt');
    const localBackupName = 'local-backup-test';
    const s3BackupName = 's3-backup-test';

    beforeAll(async () => {
        await fs.promises.mkdir(backupPath, { recursive: true });
        await fs.promises.writeFile(testFile, 'Persistence test content');

        // configure persistence on global cachify
        cachify.persistence.use('local', { path: backupPath });

        // Conditionally add S3 persistence if env exists
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

        overwatch.control.resume();
    });

    afterAll(async () => {
        await cleanup();
        await fs.promises.rm(configs.testDir, { recursive: true, force: true });
    });

    it('backs up and restores KVS records locally', async () => {
        await cachify.kvs.set('user:1', { name: 'Ahmad' });
        await cachify.persistence.backup('local', localBackupName);

        await cachify.clear();
        expect(await cachify.kvs.read('user:1')).toBeUndefined();

        await cachify.persistence.restore('local', localBackupName);
        const restored = await cachify.kvs.read('user:1');
        expect(restored).toEqual({ name: 'Ahmad' });
    });

    it('backs up and restores file cache locally', async () => {
        // Preload the file and backup
        await cachify.files.set(testFile, { preload: true, initiator: 'warmup' });
        await cachify.persistence.backup('local', localBackupName);

        // Clear cache
        await cachify.clear();
        expect(cachify.files.inspect({ filePath: testFile })).toBeUndefined();

        // Restore metadata from backup
        await cachify.persistence.restore('local', localBackupName);
        const restoredFile = cachify.files.inspect({ filePath: testFile });

        // Metadata should exist, but content is not yet loaded
        expect(restoredFile).toBeDefined();
        expect(restoredFile!.file.isCached).toBe(false);

        // Reading for the first time should return miss and load content
        const read = await cachify.files.read({ filePath: testFile });
        expect(read).toBeDefined();
        expect(read!.status).toBe('miss');
        expect(read!.content.toString()).toBe('Persistence test content');

        // Second read should be a hit
        const secondRead = await cachify.files.read({ filePath: testFile });
        expect(secondRead!.status).toBe('hit');
        expect(secondRead!.content.toString()).toBe('Persistence test content');
    });


    it('backups and restores kvs', async () => {
        await cachify.kvs.set('user:1', { name: 'Ahmad' });
        await cachify.persistence.backup('local', 'global-backup');
        await cachify.clear();
        await cachify.persistence.restore('local', 'global-backup');
        const restored = await cachify.kvs.read('user:1');
        expect(restored).toEqual({ name: 'Ahmad' });
    });

    // Conditionally test S3 if env exists
    if (process.env.S3_TEST_BUCKET) {
        it('backs up and restores KVS records to/from S3', async () => {
            await cachify.kvs.set('user:2', { name: 'Omar' });
            await cachify.persistence.backup('s3', s3BackupName);

            await cachify.clear();
            expect(await cachify.kvs.read('user:2')).toBeUndefined();

            await cachify.persistence.restore('s3', s3BackupName);
            const restored = await cachify.kvs.read('user:2');
            expect(restored).toEqual({ name: 'Omar' });
        });

        it('backs up and restores file cache to/from S3', async () => {
            await cachify.files.set(testFile, { preload: true, initiator: 'warmup' });
            await cachify.persistence.backup('s3', s3BackupName);

            await cachify.clear();
            expect(cachify.files.inspect({ filePath: testFile })).toBeUndefined();

            await cachify.persistence.restore('s3', s3BackupName);
            const restoredFile = cachify.files.inspect({ filePath: testFile });
            expect(restoredFile).toBeDefined();
            expect(restoredFile!.file.isCached).toBe(true);

            const read = await cachify.files.read({ filePath: testFile });
            expect(read!.content.toString()).toBe('Persistence test content');
        });
    }
});