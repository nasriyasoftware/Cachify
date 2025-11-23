import atomix from "@nasriya/atomix";

const string = (value: unknown, name: string, context?: string): value is string => {
    if (!atomix.valueIs.string(value)) { throw new TypeError(`The "${name}" property of the "${context ?? 'options'}" object (when provided) must be a string, but instead got ${typeof value}`) }
    return true;
}

const nonEmptyString = (value: unknown, name: string, context?: string) => {
    string(value, name, context);
    if (!value) { throw new RangeError(`The "${name}" property of the "${context ?? 'options'}" object (when provided) must not be empty, but instead got ${value}`) }
};

const number = (value: unknown, name: string, context?: string): value is number => {
    if (!atomix.valueIs.number(value)) { throw new TypeError(`The "${name}" property of the "${context ?? 'options'}" object (when provided) must be a number, but instead got ${typeof value}`) }
    return true;
}

const integer = (value: unknown, name: string, context?: string) => {
    number(value, name, context);
    if (!atomix.valueIs.integer(value)) { throw new TypeError(`The "${name}" property of the "${context ?? 'options'}" object (when provided) must be an integer, but instead got ${typeof value}`) }
}

const positiveInteger = (value: unknown, name: string, context?: string) => {
    integer(value, name, context);
    if (value as number < 0) { throw new RangeError(`The "${name}" property of the "${context ?? 'options'}" object (when provided) must be a positive integer, but instead got ${value}`) }
}

export const basicValidators = {
    string,
    nonEmptyString,
    number,
    integer,
    positiveInteger
}