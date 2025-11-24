import cachify from "./cachify";

export type {
    CacheRecord,
    CacheFlavor,
    CacheScope,
    CachePreloadInitiator,
} from "./core/docs/docs";

export type { SessionPolicyOptions } from "./core/sessions/docs";

export { CachifyError } from "./utils/CachifyError/CachifyError";
export { CachifyClient } from "./client";
export { Cachify } from "./cachify";
export default cachify;