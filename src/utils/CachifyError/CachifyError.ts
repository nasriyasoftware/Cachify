import atomix from "@nasriya/atomix";
import { CachifyErrorCode, isCachifyErrorCode } from "./types";

const hasOwnProp = atomix.dataTypes.record.hasOwnProperty;

export class CachifyError extends Error {
    readonly #_name: 'CachifyError' = 'CachifyError';
    readonly #_code: CachifyErrorCode;
    readonly #_message: string;
    readonly #_cause?: unknown;

    constructor(code: CachifyErrorCode, options?: { message?: string, cause?: unknown }) {
        const meta = {
            code: 'CACHIFY_ERROR' as CachifyErrorCode,
            message: 'Cachify Error',
            cause: undefined as unknown
        }

        if (code === undefined) {
            throw new TypeError('The "code" parameter is required and is missing.');
        }

        if (!atomix.valueIs.string(code)) { throw new TypeError(`The "code" property of the "options" object must be a string, but instead got ${typeof code}`) }
        if (code.length === 0) { throw new RangeError(`The "code" property of the "options" object must be a non-empty string`) }
        if (!isCachifyErrorCode(code)) { throw new TypeError(`The "code" property of the "options" object must be a valid CachifyErrorCode, but instead got ${code}`) }
        meta.code = code;

        if (options !== undefined) {
            if (!atomix.valueIs.record(options)) {
                throw new TypeError(`The "options" paramete (when provided) must be an object, but instead got ${typeof options}`);
            }

            if (hasOwnProp(options, 'message')) {
                if (!atomix.valueIs.string(options.message)) { throw new TypeError(`The "message" property of the "options" object (when provided) must be a string, but instead got ${typeof options.message}`) }
                if (options.message.length === 0) { throw new RangeError(`The "message" property of the "options" object (when provided) must be a non-empty string`) }
                meta.message = options.message;
            } else {
                meta.message = `A Cachify ${meta.code} error has occurred.`;
            }

            if (hasOwnProp(options, 'cause')) {
                meta.cause = options.cause;
            }
        }

        super(meta.message);
        this.#_message = meta.message;
        this.#_code = meta.code;
        this.#_cause = meta.cause;
    }

    /**
     * Returns the name of the error.
     * @returns {'CachifyError'} The name of the error.
     */
    get name(): 'CachifyError' { return this.#_name; }

    /**
     * Retrieves the error code for this CachifyError.
     * @returns {CachifyErrorCode} The error code for this CachifyError.
     */
    get code(): CachifyErrorCode { return this.#_code; }

    /**
    * Retrieves the error message associated with this CachifyError.
    * @returns {string} The error message associated with this CachifyError.
    */
    get message(): string { return this.#_message; }

    /**
     * Retrieves the underlying cause of this error, if available.
     * @returns {unknown} The cause of the error, which may be any data type or undefined if no cause is set.
     */
    get cause(): unknown { return this.#_cause }

    /**
     * Retrieves the stack trace associated with this error.
     * @returns {string | undefined} The stack trace associated with this error, or undefined if no stack trace is available.
     */
    get stack(): string | undefined { return super.stack }
}

export default CachifyError;