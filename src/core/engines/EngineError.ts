type AnyErrorClassConstructor =
    | typeof EngineError
    | typeof Error
    | typeof TypeError
    | typeof SyntaxError
    | typeof ReferenceError
    | typeof RangeError
    | typeof EvalError
    | typeof URIError
    | typeof AggregateError;

type AnyErrorInstance =
    | EngineError
    | Error
    | TypeError
    | SyntaxError
    | ReferenceError
    | RangeError
    | EvalError
    | URIError
    | AggregateError;

export class EngineError extends Error {
    readonly #_data = {
        type: Error as AnyErrorClassConstructor,
        message: '',
        stack: undefined as string | undefined,
        cause: undefined as unknown,
        errors: [] as any[],
    }

    readonly #_helpers = {
        type: {
            getType: (err: AnyErrorInstance) => {
                if (err instanceof TypeError) { return TypeError; }
                if (err instanceof SyntaxError) { return SyntaxError; }
                if (err instanceof ReferenceError) { return ReferenceError; }
                if (err instanceof RangeError) { return RangeError; }
                if (err instanceof EvalError) { return EvalError; }
                if (err instanceof URIError) { return URIError; }
                if (err instanceof AggregateError) { return AggregateError; }

                return Error;
            }
        },
        updateFrom: (err: AnyErrorInstance) => {
            this.#_data.type = this.#_helpers.type.getType(err);
            this.message = err.message;
            this.stack = err.stack;
            this.cause = err.cause;
            this.errors = err instanceof AggregateError ? err.errors : [];
        }
    }

    constructor(message: string) {
        super(message);
        this.#_data.message = message;
    }

    from(error: Error) {
        this.#_helpers.updateFrom(error);

    }

    /**
     * Retrieves the array of errors that triggered this EngineError.
     *
     * @returns {any[]} The array of errors associated with this EngineError.
     */
    get errors(): any[] { return this.#_data.errors }

    /**
     * Sets the array of errors that triggered this error.
     *
     * @param {any[]} value - The array of errors that triggered this error.
     */
    set errors(value: any[]) { this.#_data.errors = value }

    /**
     * Retrieves the underlying cause of this error, if available.
     *
     * @returns {unknown} The cause of the error, which may be any data type or undefined if no cause is set.
     */
    get cause(): unknown { return this.#_data.cause }

    /**
     * Sets the underlying cause of this error.
     *
     * @param {unknown} value The cause of the error, which may be any data type or undefined if no cause is set.
     */
    set cause(value: unknown) {
        this.#_data.cause = value
    }

    /**
     * The name of the error.
     * @readonly
     * @type {'EngineError'}
     */
    get name(): 'EngineError' { return 'EngineError' }

    /**
     * The error message associated with this EngineError.
     * @readonly
     * @type {string}
     */
    get message(): string { return this.#_data.message }

    /**
     * Sets the error message associated with this EngineError.
     * @param {string} value The error message.
     */
    set message(value: string) {
        this.#_data.message = value;
        super.message = value;
    }

    /**
     * The stack trace of the error.
     * @readonly
     * @type {string | undefined}
     */
    get stack() { return this.#_data.stack }

    /**
     * Sets the stack trace of the error.
     * @param {string | undefined} value The error stack trace.
     */
    set stack(value: string | undefined) {
        this.#_data.stack = value;
        super.stack = value;
    }
}

export default EngineError;