import CachifyError from "../../../utils/CachifyError/CachifyError";
import { SessionErrorCode } from "./error_codes";

class SessionError extends CachifyError {
    constructor(code: SessionErrorCode, options?: { message?: string, cause?: unknown }) {
        super(code, options)
    }

    /**
     * Retrieves the error code for this SessionError.
     * @returns {SessionErrorCode} The error code for this SessionError.
     */
    get code(): SessionErrorCode {
        return super.code as SessionErrorCode;
    }
}

export default SessionError;