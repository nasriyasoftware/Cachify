import atomix from "@nasriya/atomix";
import { basicValidators } from "./assert/validators";

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
    assert
}

export default utils;