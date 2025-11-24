import sessionsErrorCodes from "../../core/sessions/errors/error_codes";

const cachifyErrorCodes = [
    'CACHIFY_ERROR',
    ...sessionsErrorCodes
] as const;

export type CachifyErrorCode = typeof cachifyErrorCodes[number];

/**
 * Returns true if the given code is CachifyError, false otherwise.
 * @param code - The code to check.
 * @returns {boolean} True if the given code is `CachifyErrorCode`, false otherwise.
 */
export const isCachifyErrorCode = (code: unknown): code is CachifyErrorCode => {
    if (typeof code !== 'string') { return false }
    return cachifyErrorCodes.includes(code as CachifyErrorCode);
}