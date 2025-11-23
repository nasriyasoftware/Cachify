import SessionsController from "./SessionsController";
import type { Brand, Prettify } from "@nasriya/atomix";
import type { KVCacheController } from "../flavors/kvs/docs";
import { CacheFlavor } from "../docs/docs";


export type SessionId = Brand<string, "SessionId">;
export type RecordId = `${CacheFlavor}:${string}:${string}`;
export type SessionRecordMeta = {
    /**
     * The key of the record.
     */
    key: string;
    /**
     * The scope of the record.
     * @default 'global'
     */
    scope?: string;
}

export interface SessionPolicyOptions {
    /**
     * Whether reads should block when a record is locked.
     * Default: false (reads are allowed).
     * @default false
     */
    blockRead?: boolean;
}

export type SessionPolicy = Prettify<Readonly<Required<SessionPolicyOptions>>>;

export interface SessionConfigs {
    id: SessionId;
    controller: SessionsController;
    timeout: number;
    cacheController: KVCacheController;
    policy: Required<SessionPolicyOptions>;
}

export interface SessionOptions {
    timeout?: number;
    policy?: SessionPolicyOptions;
}