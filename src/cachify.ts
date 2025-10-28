import CachifyClient from "./client";

export class Cachify extends CachifyClient {
    /**
     * Retrieves the current debug mode status for the cache system.
     * 
     * @returns {boolean} `true` if the debug mode is enabled, `false` otherwise.
     * @since v1.0.0
     */
    get debug(): boolean {
        return process.env.CACHIFY_DEBUG === 'true'
    }

    /**
     * Sets the debug mode for the cache system.
     * 
     * If the value is `true`, the cache system will log additional information about its operations.
     * If the value is `false`, the cache system will not log any additional information.
     * 
     * @param {boolean} value - The value to set the debug mode to.
     * @throws {TypeError} Throws if the provided value is not a boolean.
     * @since v1.0.0
     */
    set debug(value: boolean) {
        if (typeof value !== 'boolean') { throw new TypeError('The provided value must be a boolean.') }
        process.env.CACHIFY_DEBUG = value ? 'true' : 'false'
    }

    /**
     * Creates a new instance of the CachifyClient class.
     * 
     * @returns {CachifyClient} A new instance of the CachifyClient class.
     * @since v1.0.0
    */
    createClient(): CachifyClient {
        return Cachify.createClient();
    }

    /**
     * Creates a new instance of the CachifyClient class.
     * 
     * @returns {CachifyClient} A new instance of the CachifyClient class.
     * @since v1.0.0
    */
    static createClient(): CachifyClient {
        return new CachifyClient();
    }
}

const cachify = new Cachify();
export default cachify;