export const sessionsErrorCodes = [
    /**
     * Thrown when the session timeout has been exceeded
     * @since v1.0.0
     */
    'SESSION_TIMEOUT',

    /**
     * Thrown when an attempt is made to perform an
     * operation on a session that has already been released
     * @since v1.0.0
     */
    'SESSIION_ALREADY_RELEASED',

    /**
     * Thrown when a record is not found in the cache
     * @since v1.0.0
     */
    'SESSION_RECORD_NOT_FOUND_IN_CACHE',

    /**
     * Thrown when a attempting to perform an operation on
     * a record that has not been acquired
     * @since v1.0.0
     */
    'SESSION_RECORD_NOT_ACQUIRED',

    /**
     * Thrown when attempting to acquire a record that has already
     * been acquired and locked *exclusively* by another session.
     * @since v1.0.0
     */
    'SESSION_RECORD_IS_EXCLUSIVE',
] as const;

export type SessionErrorCode = typeof sessionsErrorCodes[number];

export default sessionsErrorCodes;