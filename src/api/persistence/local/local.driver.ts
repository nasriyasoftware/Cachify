import fs from "fs";
import path from "path";
import PersistanceService from "../../../core/persistence/PersistanceService";
import PersistenceManager from "../../../core/persistence/persistence.manager";
import type { BackupInternalParameters, PersistanceStorageServices } from "../../../core/persistence/docs";

type BackupFunction = PersistanceStorageServices['local']['api']['private']['backup'];
type RestoreFunction = PersistanceStorageServices['local']['api']['private']['restore'];
type Configs = PersistanceStorageServices['local']['configs'];

/**
 * Resolve the absolute filesystem path for a backup file inside the cachify/backups directory.
 *
 * Validates the provided file name and resolves it against `configs.path` (or the current working directory)
 * to produce an absolute path like `<base>/cachify/backups/<fileName>`.
 *
 * @param fileName - The backup file name to resolve; must be a valid backup file name
 * @param configs - Local configuration object whose `path` property (if present) is used as the base directory
 * @returns The absolute path to the backup file
 * @throws If `fileName` is not a valid backup file name
 */
function getFilePath(fileName: string, configs: Configs) {
    assertValidBackupFileName(fileName);
    return path.resolve((configs.path || process.cwd()), 'cachify', 'backups', fileName);
}

/**
 * Validate a candidate backup file name and throw if it is invalid.
 *
 * @param name - The candidate backup file name to validate
 * @throws Error - if `name` is not a non-empty string, equals `.` or `..`, contains slashes or backslashes, contains illegal/control characters (`< > : " / \ | ? *` or control chars 0x00–0x1F), or contains `..` sequences. The thrown error's message is prefixed with `Invalid backup file name: `.
 */
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
    readonly #_manager: PersistenceManager;
    
    constructor(persistenceManager: PersistenceManager, configs: Configs) {
        super('local', configs);
        this.#_manager = persistenceManager;
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
            const restoreStream = this.#_manager.createRestoreStream();

            return await restoreStream.streamFrom(srcStream);
        } catch (error) {
            if (error instanceof Error) { error.message = `Failed to restore from "${fileNameRaw}": ${error.message}`; }
            throw error;
        }
    }
}

export default LocalStorageDriver;