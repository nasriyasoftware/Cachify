import crypto from 'crypto';
import helpers from "../helpers";
import { Transform } from "stream";
import { TransformCallbackFunc } from "../../docs";

type CustomHandler = ReturnType<typeof helpers.createCallbackHandler>;

class DecryptStream extends Transform {
    readonly #_key: Buffer;
    readonly #_ivExtractHandler = helpers.createExtractIVHandler();
    readonly #_chunkProcessor = helpers.createChunkProcessor();
    #_iv: Buffer = null as unknown as Buffer;
    #_decipher: crypto.Decipheriv = null as unknown as crypto.Decipheriv;
    #_handler: CustomHandler = null as unknown as CustomHandler;

    constructor(key: Buffer) {
        super();

        if (key.length !== 32) {
            throw new Error('Key must be 32 bytes (256 bits) long');
        }

        this.#_key = key;
    }

    #decrept(data: Buffer) {
        return this.#_decipher.update(data);
    }

    #setHandler(callback: TransformCallbackFunc) {
        this.#_handler = helpers.createCallbackHandler(callback, this.#decrept.bind(this));
    }

    #processChunk(chunk: Buffer) {
        return this.#_chunkProcessor(chunk, this.#_handler);
    }

    _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallbackFunc) {
        this.#setHandler(callback);

        try {
            if (Buffer.isBuffer(this.#_iv)) {
                return this.#processChunk(chunk);
            }

            const res = this.#_ivExtractHandler(chunk);
            if (!res.found) { return callback() }

            this.#_iv = res.iv;
            this.#_decipher = crypto.createDecipheriv('aes-256-cbc', this.#_key, this.#_iv);

            return this.#processChunk(res.rest);
        } catch (error) {
            callback(error as Error);
        }
    }

    _flush(callback: TransformCallbackFunc) {
        this.#setHandler(callback);

        try {
            if (!this.#_decipher) {
                // No data processed at all
                return callback();
            }

            this.#_chunkProcessor.flush(this.#_handler);
            const final = this.#_decipher.final();
            this.push(final);
        } catch (err) {
            callback(err as Error);
        } finally {
            this.#_handler = null as any;
            this.#_iv = null as any;
            this.#_decipher = null as any;
        }
    }
}

export default DecryptStream;