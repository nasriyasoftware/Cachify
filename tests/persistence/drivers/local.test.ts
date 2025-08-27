import fs from "fs";
import path from "path";
import cachify from "../../../src/cachify";
import { cleanup } from "../../helpers/helpers";

const backupFileName = "integration-backup";
const backupDir = path.join(process.cwd(), 'tests', 'backups');
const testFilePath = path.join(process.cwd(), 'tests', 'persistence', 'assets', "sample.txt");

describe("Persistence Integration (backup & restore)", () => {
    beforeAll(() => {
        // Ensure backup dir exists
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        cachify.persistence.use("local", { path: backupDir });
    });

    afterAll(async () => {
        // Cleanup backup files
        await fs.promises.rm(backupDir, { recursive: true, force: true });
        await cleanup();
    });

    describe("KV cache", () => {
        it("should backup and restore KV records", async () => {
            // Insert records
            await Promise.all([
                cachify.kv.set("a", 1),
                cachify.kv.set("b", 2),
            ])

            expect(cachify.kv.size).toBe(2);

            // Backup
            await cachify.persistence.backup("local", backupFileName);

            // Clear
            await cachify.kv.clear();
            expect(cachify.kv.size).toBe(0);

            // Restore
            await cachify.persistence.restore("local", backupFileName);

            // Assert restored
            expect(cachify.kv.size).toBe(2);
            const [a, b] = await Promise.all([
                cachify.kv.get("a"),
                cachify.kv.get("b"),
            ])
            
            expect(a).toBe(1);
            expect(b).toBe(2);
        });
    });

    describe("Files cache", () => {
        it("should backup and restore Files records", async () => {
            // Insert file record
            await cachify.files.set(testFilePath);

            expect(cachify.files.size).toBe(1);

            // Backup
            await cachify.persistence.backup("local", backupFileName);

            // Clear
            await cachify.files.clear();
            expect(cachify.files.size).toBe(0);

            // Restore
            await cachify.persistence.restore("local", backupFileName);

            // Assert restored metadata
            expect(cachify.files.size).toBe(1);

            // Assert restored file is still readable
            const restored = await cachify.files.read({ filePath: testFilePath });
            expect(restored).toBeDefined();
            expect(restored?.content.toString()).toContain("Hello"); // adjust content
        });
    });
});
