import fs from "fs";
import path from "path";
import { BackupInternalParameters, PersistanceStorageServices } from "../../core/persistence/docs";
import PersistanceService from "../../core/persistence/PersistanceService";
import persistenceManager from "../../core/persistence/persistence.manager";

type BackupFunction = PersistanceStorageServices['local']['api']['private']['backup'];
type RestoreFunction = PersistanceStorageServices['local']['api']['private']['restore'];
type Configs = PersistanceStorageServices['local']['configs'];

function getFilePath(fileName: string, configs: Configs) {
    assertValidBackupFileName(fileName);
    return path.resolve((configs.path || process.cwd()), 'cachify', 'backups', fileName);
}

function assertValidBackupFileName(name: string): void {
    try {
        if (typeof name !== 'string' || !name.trim()) {
            throw new Error(`Backup file name must be a non-empty string`);
        }

        const trimmed = name.trim();

        if (trimmed === '.' || trimmed === '..') {
            throw new Error(`Invalid backup file name: "${trimmed}" is not allowed`);
        }

        if (/[\\/]/.test(trimmed)) {
            throw new Error(`Backup file name (${name}) must not contain slashes or backslashes`);
        }

        if (/[<>:"/\\|?*\x00-\x1F]/.test(trimmed)) {
            throw new Error(`Backup file name (${name}) contains illegal or control characters`);
        }

        // Optional: prevent directory traversal via sneaky names
        if (trimmed.includes('..')) {
            throw new Error(`Backup file name (${name}) must not be a relative path and must not contain ".."`);
        }
    } catch (error) {
        if (error instanceof Error) { error.message = `Invalid backup file name: ${error.message}`; }
        throw error;
    }
}

class LocalStorageDriver extends PersistanceService<'local'> {
    constructor(configs: Configs) {
        super('local', configs);
    }

    /**
     * Backs up all records to the specified file path.
     *
     * @returns {Promise<void>} Resolves when the backup completes.
     * @throws {Error} If an error occurs while writing to the file.
     */
    async backup(...args: BackupInternalParameters<'local'>): ReturnType<BackupFunction> {
        const [flavor, backupStream, fileNameRaw] = args;

        try {
            const ext = path.extname(fileNameRaw);
            const baseName = path.basename(fileNameRaw, ext); // filename without extension
            const backupName = `${flavor}-${baseName}.backup`;

            const fileName = getFilePath(backupName, this.configs);
            const destDir = path.dirname(fileName);
            fs.mkdirSync(destDir, { recursive: true });

            const destStream = fs.createWriteStream(fileName);
            return await backupStream.streamTo(destStream);
        } catch (error) {
            if (error instanceof Error) { error.message = `Failed to backup to "${fileNameRaw}": ${error.message}`; }
            throw error;
        }

    }

    /**
     * Restores records from a specified file path.
     *
     * @returns {Promise<void>} A promise that resolves when the restore operation completes.
     * @throws {Error} If an error occurs while reading from the file.
     */
    async restore(...args: Parameters<RestoreFunction>): ReturnType<RestoreFunction> {
        const [flavor, fileNameRaw] = args;

        try {
            const ext = path.extname(fileNameRaw);
            const baseName = path.basename(fileNameRaw, ext); // filename without extension
            const backupName = `${flavor}-${baseName}.backup`;
            const finalPath = getFilePath(backupName, this.configs);

            const exist = fs.existsSync(finalPath);
            if (!exist) { return }

            const srcStream = fs.createReadStream(finalPath);
            const restoreStream = persistenceManager.createRestoreStream();

            return await restoreStream.streamFrom(srcStream);
        } catch (error) {
            if (error instanceof Error) { error.message = `Failed to restore from "${fileNameRaw}": ${error.message}`; }
            throw error;
        }
    }
}

export default LocalStorageDriver;