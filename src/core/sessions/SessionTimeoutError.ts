import type { SessionId } from "./docs";

class SessionTimeoutError extends Error {
    name = 'SessionTimeoutError';

    constructor(id: SessionId) {
        super();
        this.message = `Session ${id} has timed out.`;
    }

    readonly code = 'CACHIFY_SESSION_TIMEOUT';
}

export default SessionTimeoutError;