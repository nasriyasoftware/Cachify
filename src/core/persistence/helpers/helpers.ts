import CachifyClient from '../../../client';
import crypto from 'crypto';
import constants from "../../consts/consts";
import validateService from "./service.validator";
import type { ExportedData, StorageServices, TransformCallbackFunc } from "../docs";
import type { FilePreloadRestoreSetOptions } from '../../flavors/files/docs';
import type { KVPreloadRestoreSetOptions } from '../../flavors/kvs/docs';

const helpers = {
    validateService(service: StorageServices, configs: any) {
        return validateService[service](configs);
    },

    streamToBuffer(stream: any): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.once('end', () => resolve(Buffer.concat(chunks)));
            stream.once('error', reject);
        });
    },

    getEncryptionKey() {
        const PASSPHRASE = process.env.CACHIFY_ENC_PASSPHRASE;
        if (!PASSPHRASE) { return null }

        const SALT = 'a3f1c4e98d7b2f1a4e3c0d5f9b8e1a2f';
        // Derive 32-byte key from passphrase + salt
        const key = crypto.scryptSync(PASSPHRASE, SALT, 32);
        return key;
    },

    /**
     * Creates a handler function to extract an Initialization Vector (IV) from a stream of data.
     *
     * The returned handler function processes chunks of data, accumulating them until
     * the required IV size is reached. Once the IV size is met or exceeded, it extracts
     * the IV and returns it along with any remaining data.
     *
     * @returns A function that takes a data chunk as input and returns an object indicating
     *          whether the IV has been found. If found, it includes the `iv` and the `rest` of
     *          the data; otherwise, it indicates that the IV is not yet found.
     */
    createExtractIVHandler() {
        const IV_SIZE = constants.STREAM_CIPHER_IV_SIZE;
        const chunks: Buffer[] = [];
        let length = 0;

        return (chunk: Buffer): { found: false } | { found: true, iv: Buffer, rest: Buffer } => {
            try {
                chunks.push(chunk);
                length += chunk.length;

                if (length < IV_SIZE) {
                    return { found: false }
                }

                // Concatenate buffered chunks to extract IV and data after it
                const buffer = Buffer.concat(chunks, length);
                const iv = buffer.subarray(0, IV_SIZE);
                const rest = buffer.subarray(IV_SIZE);

                return { found: true, iv, rest };
            } catch (error) {
                throw error
            }
        }
    },

    /**
     * Creates a chunk processor function that processes data in blocks of a specified size.
     * 
     * The processor accumulates data chunks until the total length equals the block size, 
     * at which point it invokes the callback with the concatenated data. Any remaining data 
     * is stored for the next invocation.
     * 
     * The processor also includes a `flush` method to handle any remaining data that did not 
     * fill a complete block, ensuring that all data is processed.
     * 
     * @returns A function that processes data chunks and manages block completion 
     * and error handling through the provided callback.
     */
    createChunkProcessor() {
        const BLOCK_SIZE = constants.STREAM_CIPHER_BLOCK_SIZE;
        const chunks: Buffer[] = [];
        let length = 0;

        const processor = (chunk: Buffer, callback: ReturnType<typeof this.createCallbackHandler>) => {
            try {
                while (chunk.length > 0) {
                    const blockLength = BLOCK_SIZE - length;
                    const block = chunk.subarray(0, blockLength);

                    chunks.push(block);
                    length += block.length;

                    if (length === BLOCK_SIZE) {
                        callback.processAndPush(Buffer.concat(chunks, length));
                        chunks.length = 0;
                        length = 0;
                    }

                    chunk = chunk.subarray(blockLength);
                }
            } catch (error) {
                callback.onError(error as Error);
            }
        };

        processor.flush = (callback: ReturnType<typeof this.createCallbackHandler>) => {
            try {
                if (length > 0) {
                    callback.processAndPush(Buffer.concat(chunks, length));
                    chunks.length = 0;
                    length = 0;
                }
            } catch (error) {
                callback.onError(error as Error);
            }
        };

        return processor;
    },

    /**
     * Creates a callback handler for the `Transform` stream.
     *
     * @param callback - The callback to be called when a chunk is processed.
     * @param onChunkBlock - A function that takes a chunk and processes it.
     * @returns An object with two properties: `onError` and `respond`.
     *          `onError` takes an error as an argument and calls the callback with it.
     *          `respond` takes a chunk as an argument and processes it with `onChunkBlock`
     *          before calling the callback with the processed chunk.
     */
    createCallbackHandler(callback: TransformCallbackFunc, onChunkBlock: (chunk: Buffer) => Buffer) {
        return {
            onError: (error: Error) => callback(error),
            processAndPush: (data?: Buffer) => {
                const final = Buffer.isBuffer(data) ? onChunkBlock(data) : undefined;
                if (final) {
                    callback(null, final);
                } else {
                    callback();
                }
            }
        }
    },

    /**
     * Sets a record in the cache using the restored data.
     * If the record has expired, it is not set.
     * If the record is of an unsupported or unimplemented flavor, an error is thrown.
     * @param record - The record to set in the cache.
     * @returns A promise that resolves when the record is set in the cache.
     */
    setRecord(record: ExportedData, client: CachifyClient) {
        try {
            const now = Date.now();
            const expireAt = record.stats.dates.expireAt;

            if (expireAt !== undefined && now >= expireAt) {
                return;
            }

            let action: Promise<unknown>;
            switch (record.flavor) {
                case 'files': {
                    const configs: FilePreloadRestoreSetOptions = {
                        preload: true,
                        initiator: 'restore',
                        scope: record.scope,
                        key: record.key,
                        stats: record.stats,
                        ttl: record.ttl,
                        storeIn: record.engines,
                        file: record.file
                    }

                    action = client.files.set(record.file.path, configs);
                }
                    break;

                case 'kvs': {
                    const configs: KVPreloadRestoreSetOptions = {
                        preload: true,
                        initiator: 'restore',
                        scope: record.scope,
                        stats: record.stats,
                        ttl: record.ttl,
                        storeIn: record.engines,
                    }

                    action = client.kvs.set(record.key, record.value, configs);
                }
                    break;

                default: {
                    throw new Error(`Unsupported or unimplemented flavor: ${(record as any).flavor}`);
                }
            }

            return action;
        } catch (error) {
            throw error;
        }
    }
}

export default helpers;