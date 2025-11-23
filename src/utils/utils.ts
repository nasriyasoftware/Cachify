import atomix from "@nasriya/atomix";
import { basicValidators } from "./assert/validators";
import { CacheRecord } from "../core/docs/docs";
import KVCacheRecord from "../core/flavors/kvs/kvs.record";
import FileCacheRecord from "../core/flavors/files/files.record";

const hasOwnProp = atomix.dataTypes.record.hasOwnProperty;

const assert = {
    type: basicValidators,
    objectProp: (
        obj: Record<any, any>,
        prop: string,
        options: {
            required?: boolean,
            context?: string,
            onValidResult?: () => void,
            validator?: (value: unknown, name: string, context?: string) => void,
        } = { required: false },
    ) => {
        if (hasOwnProp(obj, prop)) {
            options?.validator?.(obj[prop], prop, options.context);
            options?.onValidResult?.();
        } else if (options.required) {
            throw new RangeError(`The "${options.context ?? 'options'}" object (when provided) must contain a "${prop}" property.`)
        }
    }
}

const utils = {
    assert,
    /**
     * Checks if the given value is a CacheRecord.
     *
     * @param {unknown} value
     * @returns {value is CacheRecord} whether or not the given value is a CacheRecord
     */
    isCacheRecord(value: unknown): value is CacheRecord {
        return value instanceof KVCacheRecord || value instanceof FileCacheRecord;
    }
}

export default utils;