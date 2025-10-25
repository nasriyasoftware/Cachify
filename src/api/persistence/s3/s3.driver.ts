import atomix from "@nasriya/atomix";
import PersistanceService from "../../../core/persistence/PersistanceService";
import PersistenceManager from "../../../core/persistence/persistence.manager";
import { PassThrough } from "stream";
import type { BackupInternalParameters, PersistanceStorageServices } from "../../../core/persistence/docs";

type BackupFunction = PersistanceStorageServices['s3']['api']['private']['backup'];
type RestoreFunction = PersistanceStorageServices['s3']['api']['private']['restore'];
type Configs = PersistanceStorageServices['s3']['configs'];

class S3StorageDriver extends PersistanceService<'s3'> {
    readonly #_manager: PersistenceManager;
    #_client: any;
    #_PutObjectCommand: any;
    #_GetObjectCommand: any;

    constructor(persistenceManager: PersistenceManager, configs: Configs) {
        super('s3', configs);
        this.#_manager = persistenceManager;
    }

    async #_init() {
        if (this.#_client) { return }
        const moduleName = '@aws-sdk/client-s3';

        let mod;
        try {
            mod = await atomix.runtime.loadModule(moduleName);
        } catch (error) {
            const newErr = new Error(`S3 driver requires "${moduleName}". Please install it with "npm i ${moduleName}".`);
            newErr.cause = error;
            throw newErr;
        }

        this.#_client = new mod.S3Client(this.configs);
        this.#_GetObjectCommand = mod.GetObjectCommand;
        this.#_PutObjectCommand = mod.PutObjectCommand;
    }

    /**
     * Uploads a readable stream to the specified S3 bucket.
     *
     * @throws {Error} Throws an error if initialization fails or the S3 client is not available.
     * @returns {Promise<void>} A promise that resolves when the upload is complete.
     */
    async backup(...args: BackupInternalParameters<'s3'>): ReturnType<BackupFunction> {
        const [_, backupStream, key] = args;

        try {
            await this.#_init();
            const stream = new PassThrough()

            const command = new this.#_PutObjectCommand({
                Bucket: this.configs.bucket,
                Key: key,
                Body: stream
            });

            const sendPromise = this.#_client.send(command);
            await backupStream.streamTo(stream);
            await sendPromise;
        } catch (err) {
            if (err instanceof Error) { err.message = `Failed to upload to S3: ${err.message}`; }
            throw err;
        }
    }

    /**
     * Downloads an object from the specified S3 bucket.
     *
     * @throws {Error} Throws an error if initialization fails or the S3 client is not available.
     * @returns {Promise<Buffer>} A promise that resolves with the content of the downloaded object.
     */
    async restore(...args: Parameters<RestoreFunction>): ReturnType<RestoreFunction> {
        const [key] = args;

        try {
            await this.#_init();
            const command = new this.#_GetObjectCommand({
                Bucket: this.configs.bucket,
                Key: key,
            });

            const response = await this.#_client.send(command);
            if (!response.Body) { throw new Error(`S3 object "${key}" not found`) }

            const restoreStream = this.#_manager.createRestoreStream();
            return await restoreStream.streamFrom(response.Body);
        } catch (error) {
            if (error instanceof Error) { error.message = `Failed to download from S3: ${error.message}`; }
            throw error;
        }
    }
}

export default S3StorageDriver;