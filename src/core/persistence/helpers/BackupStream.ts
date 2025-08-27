import { Readable, Writable } from "stream";
import { once } from "events";
import EncryptStream from "./streams/EncryptStream";
import helpers from "./helpers";

type ErrorHandler = (err: Error) => void;

class BackupStream {
    readonly #_stream: Readable;
    readonly #_encryptStream: EncryptStream | undefined;
    #_errorHandler = (err: Error) => this.#_userErrorHandler?.(err);
    #_userErrorHandler: ErrorHandler | undefined;
    #_closed = false;

    constructor() {
        // Create a Readable in "object mode" to allow pushing strings easily
        this.#_stream = new Readable({
            read() { /** no-op; push manually */ },
            encoding: 'utf-8',
            objectMode: false
        })

        this.#_stream.on('error', this.#_errorHandler);

        const encryptionKey = helpers.getEncryptionKey();
        if (encryptionKey) {
            this.#_encryptStream = new EncryptStream(encryptionKey);
            this.#_encryptStream.on('error', this.#_errorHandler);
        }

        // Push initial header lines
        this.#_controller.push(`CACHE_BACKUP v1\n`);
        this.#_controller.push(`CREATED_AT ${new Date().toISOString()}\n`);
    }

    readonly #_controller = {
        push: (chunk: string) => {
            if (this.#_closed) {
                throw new Error("Cannot push after stream is closed");
            }
            // Push data to the readable stream
            // Return false if the internal buffer is full (backpressure)
            const ok = this.#_stream.push(chunk);
            return ok;
        },
        writeRecordSync: (record: Record<string, unknown>): boolean => {
            const json = JSON.stringify(record);
            return this.#_controller.push(`RECORD ${json}\n`);
        }
    }

    /**
     * Writes a record to the persistence stream asynchronously.
     * 
     * This method is asynchronous to allow for backpressure handling.
     * If the internal buffer is full (i.e. the writable stream is not consuming data as fast as `writeRecord` is being called)
     * then this method will await the 'drain' event on the readable stream before returning.
     * 
     * If the stream is already closed, this method does nothing and returns false.
     * @param record - The record to write to the persistence.
     * @returns A promise that resolves with a boolean indicating whether the write was successful.
     * @since v1.0.0
     */
    async writeRecord(record: Record<string, unknown>): Promise<boolean> {
        const ok = this.#_controller.writeRecordSync(record);
        if (!ok) {
            await once(this.#_stream, 'drain');
        }
        return ok;
    }

    /**
     * Closes the persistence stream.
     * 
     * This method is called when the persistence stream is finished writing records.
     * It will write a footer line to the stream and then signal the end of the stream.
     * If the internal buffer is full (i.e. the writable stream is not consuming data as fast as `writeRecord` is being called)
     * then this method will await the 'drain' event on the readable stream before returning.
     * @since v1.0.0
     */
    async close() {
        if (this.#_closed) { return }
        if (!this.#_controller.push(`END_BACKUP\n`)) {
            await once(this.#_stream, 'drain');
        }
        this.#_closed = true;
        this.#_stream.push(null); // Signal end of stream
    }

    /**
     * Sets the error handler for the persistence stream.
     *
     * If an error occurs on the readable or writable stream (i.e. when writing to the stream or when the stream is piped to a destination),
     * then the handler will be called with the error as an argument.
     * If the handler is not set, then errors will be thrown.
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
     * @param dest - The writable stream to pipe the internal readable stream to.
     * @returns A promise that resolves when the writable stream is finished consuming data.
     * @since v1.0.0
     */
    async streamTo(dest: Writable) {
        return new Promise<void>((resolve, reject) => {
            const handleError = (err: unknown) => {
                dest.destroy();
                this.#_encryptStream?.destroy();
                this.#_stream.destroy();
                reject(err);
            };

            this.#onError(handleError);
            dest.on('finish', resolve);
            dest.on('error', handleError);

            let current = this.#_stream;
            if (this.#_encryptStream) {
                current.pipe(this.#_encryptStream);
                current = this.#_encryptStream;
            }

            current.pipe(dest);
        })
    }
}

export default BackupStream;