import crypto from 'crypto';
import helpers from "../helpers";
import { Transform } from "stream";
import { TransformCallbackFunc } from "../../docs";

type CustomHandler = ReturnType<typeof helpers.createCallbackHandler>;

class EncryptStream extends Transform {
    readonly #_key: Buffer;
    readonly #_chunkProcessor = helpers.createChunkProcessor();
    readonly #_iv: Buffer = null as unknown as Buffer;
    readonly #_cipher: crypto.Cipheriv;
    #_handler: CustomHandler = null as unknown as CustomHandler;
    #ivSent = false;

    constructor(key: Buffer) {
        super();

        if (key.length !== 32) {
            throw new Error('Key must be 32 bytes (256 bits) long');
        }

        this.#_key = key;
        this.#_iv = crypto.randomBytes(16); // 128-bit IV for AES-256-CBC
        this.#_cipher = crypto.createCipheriv('aes-256-cbc', this.#_key, this.#_iv);
    }

    #encrypt(data: Buffer) {
        return this.#_cipher.update(data);
    }

    #setHandler(callback: TransformCallbackFunc) {
        this.#_handler = helpers.createCallbackHandler(callback, this.#encrypt.bind(this));
    }

    #processChunk(chunk: Buffer) {
        return this.#_chunkProcessor(chunk, this.#_handler);
    }

    _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallbackFunc) {
        this.#setHandler(callback);
        try {
            if (!this.#ivSent) {
                // Push the IV first so decryptor can read it
                this.push(this.#_iv);
                this.#ivSent = true;
            }

            this.#processChunk(chunk);
        } catch (err) {
            callback(err as Error);
        }
    }

    _flush(callback: TransformCallbackFunc) {
        this.#setHandler(callback);

        try {
            this.#_chunkProcessor.flush(this.#_handler);
            const final = this.#_cipher.final();
            this.push(final);
        } catch (err) {
            callback(err as Error);
        }
    }
}

export default EncryptStream;