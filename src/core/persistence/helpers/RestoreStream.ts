import { Readable, Writable } from "stream";
import { ExportedData } from "../docs";
import helpers from "./helpers";
import DecryptStream from "./streams/DecryptStream";
import StreamLinesParser from "./streams/StreamLinesParser";
import restoreQueue from "./restoreQueue";
import CachifyClient from "../../../client";

type ErrorHandler = (err: Error) => void;

class RestoreStream {
    readonly #_client: CachifyClient;
    readonly #_streams;
    #_userErrorHandler: ErrorHandler | undefined;
    #_errorHandler = (err: Error) => {
        if (typeof this.#_userErrorHandler === 'function') { this.#_userErrorHandler(err) } else { throw err }
    };

    constructor(client: CachifyClient) {
        this.#_client = client;

        this.#_streams = Object.freeze({
            lineParser: new StreamLinesParser(),
            decryptor: (() => {
                const encryptionKey = helpers.getEncryptionKey();
                if (encryptionKey) {
                    return new DecryptStream(encryptionKey);
                }
            })(),

            handler: new Writable({
                decodeStrings: false,  // Disable automatic string decoding
                defaultEncoding: 'utf8',
                write: (chunk: string, _enc, cb) => {
                    chunk = chunk.trim();

                    try {
                        // Only process RECORD lines
                        if (!chunk.startsWith('RECORD ')) return cb();

                        const firstSpace = chunk.indexOf(' ');
                        const recordData = chunk.slice(firstSpace + 1);

                        const data = JSON.parse(recordData) as ExportedData;

                        const setAction = helpers.setRecord(data, this.#_client);
                        if (!setAction) { return cb() } // It means the record is expired

                        restoreQueue.addTask({
                            type: data.flavor,
                            action: async () => await setAction,
                            onReject(error) {
                                const err = new AggregateError([error, new Error(`Failed to restore record: ${data.key}`)]);
                                console.error(err);
                            },
                        })

                        cb();
                    } catch (error) {
                        cb(error as Error);
                    }
                },
                final: async (cb) => {
                    try {
                        await restoreQueue.untilComplete();
                        cb();
                    } catch (error) {
                        cb(error as Error);
                    }
                }
            })
        })

        this.#_helpers.setErrorHandlers();
    }

    readonly #_helpers = {
        setErrorHandlers: () => {
            this.#_streams.decryptor?.on('error', this.#_errorHandler);
            this.#_streams.lineParser.on('error', this.#_errorHandler);
            this.#_streams.handler.on('error', this.#_errorHandler);
        },
        pipe: (input: Readable) => {
            const { decryptor, lineParser, handler } = this.#_streams;
            const hasDecryptor = decryptor instanceof DecryptStream;

            let current = input;
            if (hasDecryptor) {
                current.pipe(decryptor!);
                current = decryptor!;
            }

            current.pipe(lineParser).pipe(handler);
        }
    }

    /**
     * Sets the error handler for the persistence stream.
     *
     * If an error occurs on the readable or writable stream (i.e. when writing to the stream or when the stream is piped to a destination),
     * then the handler will be called with the error as an argument.
     * @param handler - The error handler to call when an error occurs.
     * @throws {TypeError} If the provided handler is not a function.
     * @since v1.0.0
     */
    #onError(handler: (err: Error) => void) {
        if (typeof handler !== 'function') { throw new TypeError(`The provided handler (${handler}) is not a function.`) }
        this.#_userErrorHandler = handler;
    }

    /**
     * Pipes the internal readable stream to the provided writable stream.
     *
     * This method returns a promise that resolves when the writable stream is finished consuming data.
     * If an error occurs on either the readable or writable stream, then the promise will reject with the error.
     * The writable stream is destroyed when an error occurs.
     *
     * @param input - The readable stream to pipe the internal readable stream to.
     * @returns A promise that resolves when the writable stream is finished consuming data.
     * @since v1.0.0
     */
    async streamFrom(input: Readable) {
        return new Promise<void>((resolve, reject) => {
            const handleError = (err: unknown) => {
                input.destroy();
                this.#_streams.decryptor?.destroy();
                this.#_streams.lineParser.destroy();
                this.#_streams.handler.destroy();
                reject(err);
            };

            this.#onError(handleError);

            input.on('error', handleError);
            this.#_streams.handler.on('finish', resolve);
            this.#_helpers.pipe(input);
        })
    }
}

export default RestoreStream;