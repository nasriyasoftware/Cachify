import cachify from "../../src/cachify";
import overwatch from "@nasriya/overwatch";
import atomix from "@nasriya/atomix";
import { cleanup } from "../helpers/helpers";

import fs from "fs/promises";
import path from "path";
import os from "os";

const testDir = path.join(os.tmpdir(), "nasriya", "cachify");
// cachify.debug = true;

describe("Files Cache Manager Integration", () => {
    let originalDetectionInterval = overwatch.detectionInterval;

    const filesPaths = {
        test: path.join(testDir, 'testfile.txt'),
        smallFile: path.join(testDir, 'small-text.txt'),
        largeFile: path.join(testDir, 'large-text.txt')
    }

    beforeAll(async () => {
        overwatch.control.pause();
        overwatch.detectionInterval = 200;

        // Create a temp directory for tests
        await fs.mkdir(testDir, { recursive: true });
        await Promise.all([
            fs.writeFile(filesPaths.smallFile, "a".repeat(1024 * 1024)), // 1 MB
            fs.writeFile(filesPaths.largeFile, "b".repeat(1024 * 1024 * 2)), // 2 MB
            fs.writeFile(filesPaths.test, "Hello, world!")
        ]);

        overwatch.control.resume();
    });

    afterAll(async () => {
        overwatch.detectionInterval = originalDetectionInterval;
        // Clean up temp directory
        await Promise.all([
            fs.rm(testDir, { recursive: true, force: true }),
            cleanup()
        ]);
    });

    afterEach(async () => {
        // Clear the cache after each test
        await cachify.files.clear();
    });

    it("should evict least used file when memory size exceeds limit", async () => {
        // Set very small limit
        cachify.files.configs.maxFileSize = 1024 * 1024 * 2;  // 2MB
        cachify.files.configs.maxTotalSize = 1024 * 1024 * 2.5; // 3MB

        // Add small file (will fit)
        await cachify.files.set(filesPaths.smallFile, { preload: true, initiator: 'warmup' });

        // Add large file (exceeds memory size, should trigger eviction)
        await cachify.files.set(filesPaths.largeFile, { preload: true, initiator: 'warmup' });

        const record = cachify.files.inspect({ filePath: filesPaths.smallFile });
        expect(record?.file.isCached).toBe(false); // evicted from memory
    });

    it("should expire file record after TTL", async () => {
        cachify.files.configs.ttl.enabled = true;
        cachify.files.configs.ttl.value = 100; // 100ms TTL
        cachify.files.configs.ttl.policy = "evict";

        await cachify.files.set(filesPaths.smallFile, { preload: true, initiator: 'warmup' });

        // Wait for TTL to expire
        await new Promise(res => setTimeout(res, 150));

        const record = cachify.files.inspect({ filePath: filesPaths.smallFile });
        expect(record).toBeUndefined(); // Evicted due to TTL
    });

    it("should set and preload a file cache record", async () => {
        await cachify.files.set(filesPaths.test);
        const record = cachify.files.inspect({ filePath: filesPaths.test });

        expect(record).toBeDefined();
        expect(record?.file.name).toBe(path.basename(filesPaths.test));
        expect(record?.flavor).toBe("files");
    });

    it("should read cached content with a miss status on first read", async () => {
        await cachify.files.set(filesPaths.test);
        const readResult = await cachify.files.read({ filePath: filesPaths.test });
        expect(readResult).toBeDefined();
        expect(readResult?.status).toBe("miss"); // because it reads from disk
        expect(readResult?.content.toString()).toBe("Hello, world!");
    });

    it("should return hit on second read after content is cached", async () => {
        await cachify.files.set(filesPaths.test, { preload: true, initiator: 'warmup' });
        const key = atomix.http.btoa(filesPaths.test);

        await cachify.files.read({ key }); // first read triggers miss + caching
        const secondRead = await cachify.files.read({ key }); // content is now cached

        expect(secondRead?.status).toBe("hit");
        expect(secondRead?.content.toString()).toBe("Hello, world!");
    });

    it('should return hit on the first read when created with "warmup" preload initiator', async () => {
        await cachify.files.set(filesPaths.test, { preload: true, initiator: 'warmup' });

        const response = await cachify.files.read({ filePath: filesPaths.test });
        expect(response?.status).toBe("hit");
        expect(response?.content.toString()).toBe("Hello, world!");
    })

    it("should return miss status and load content on first read", async () => {
        await cachify.files.set(filesPaths.test, { preload: false });
        const key = Buffer.from(filesPaths.test).toString("base64");

        const readResult = await cachify.files.read({ key });
        expect(readResult).toBeDefined();
        expect(readResult?.status).toBe("miss");
        expect(readResult?.content.toString()).toBe("Hello, world!");
    });

    it("should detect removal from cache", async () => {
        await cachify.files.set(filesPaths.test);
        const key = atomix.http.btoa(filesPaths.test);

        expect(cachify.files.has({ key })).toBe(true);
        const removed = await cachify.files.remove({ key });
        expect(removed).toBe(true);
        expect(cachify.files.has({ key })).toBe(false);
    });

    it("should clear all cached files", async () => {
        await cachify.files.set(filesPaths.test);
        expect(cachify.files.size).toBe(1);

        await cachify.files.clear();

        expect(cachify.files.size).toBe(0);
    });

    it("should update content (when it's already cached) after file change", async () => {
        await cachify.files.set(filesPaths.test, { ttl: { value: 10000, flavor: 'files' } });
        await cachify.files.read({ filePath: filesPaths.test });

        // Modify the file contents on disk
        await fs.writeFile(filesPaths.test, "Updated content");

        // Wait some time for watcher/refresh to pick up change
        await new Promise(resolve => setTimeout(resolve, 220));

        // Read again and verify updated content
        const readResult = await cachify.files.read({ filePath: filesPaths.test });
        expect(readResult!.content.toString()).toBe("Updated content");
    });
});
