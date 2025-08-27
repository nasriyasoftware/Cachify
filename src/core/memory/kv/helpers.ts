import atomix from "@nasriya/atomix";
import enginesManager from "../../engines/manager";
import KVCacheConfig from "../../configs/managers/kv/KVCacheConfig";
import utils from "../../../utils/utils";
import type { TTLKVOptions } from "../../configs/strategies/ttl/TTLConfig";
import type { KVNormalSetConfigs, KVNormalSetOptions, KVPreloadRestoreSetConfigs, KVPreloadRestoreSetOptions, KVPreloadSetConfigs, KVPreloadWarmupSetConfigs, KVPreloadWarmupSetOptions, KVSetOptions } from "./docs";
import type { CachePreloadInitiator } from "../../docs/docs";
import constants from "../../consts/consts";

const hasOwnProperty = atomix.dataTypes.record.hasOwnProperty;

class KVHelpers {
    readonly #_defaults = {
        setConfigs: (cacheConfig: KVCacheConfig) => {
            const configs: KVNormalSetConfigs = {
                preload: false,
                scope: 'global',
                storeIn: [],
                ttl: {
                    flavor: 'kv',
                    value: cacheConfig.ttl.enabled ? cacheConfig.ttl.value : 0,
                    onExpire: cacheConfig.ttl.onExpire,
                    sliding: cacheConfig.ttl.sliding
                }
            }

            return atomix.dataTypes.object.smartClone(configs);
        }
    }

    readonly #_helpers = {
        validate: {
            set: {
                normalOptions: (options: KVNormalSetOptions, cacheConfigs: KVCacheConfig) => {
                    const configs = this.#_defaults.setConfigs(cacheConfigs);

                    if (hasOwnProperty(options, 'scope')) {
                        if (!atomix.valueIs.string(options.scope)) { throw new TypeError(`The "scope" property of the "options" object (when provided) must be a string, but instead got ${typeof options.scope}`) }
                        if (options.scope.length === 0) { throw new RangeError(`The "scope" property of the "options" object (when provided) must be a non-empty string`) }
                        configs.scope = options.scope;
                    }

                    if (hasOwnProperty(options, 'ttl')) {
                        const ttl = options.ttl;
                        const isRecord = atomix.valueIs.record(ttl);
                        const isNumber = atomix.valueIs.number(ttl);

                        if (!(isNumber || isRecord)) { throw new TypeError(`The "ttl" property of the "options" object (when provided) must be a number or a record, but instead got ${typeof ttl}`) }

                        if (isNumber) {
                            (configs.ttl as TTLKVOptions).value = ttl;
                        }

                        if (isRecord) {
                            if (hasOwnProperty(ttl, 'value')) {
                                if (!atomix.valueIs.number(ttl.value)) { throw new TypeError(`The "value" property of the "ttl" object (when provided) must be a number, but instead got ${typeof ttl.value}`) }
                                if (!atomix.valueIs.integer(ttl.value)) { throw new TypeError(`The "value" property of the "ttl" object (when provided) must be an integer, but instead got ${ttl.value}`) }
                                (configs.ttl as TTLKVOptions).value = ttl.value;
                            }

                            if (hasOwnProperty(ttl, 'sliding')) {
                                if (typeof ttl.sliding !== 'boolean') { throw new TypeError(`The "sliding" property of the "ttl" object (when provided) must be a boolean, but instead got ${typeof ttl.sliding}`) }
                                (configs.ttl as TTLKVOptions).sliding = ttl.sliding;
                            }

                            if (hasOwnProperty(ttl, 'onExpire')) {
                                if (typeof ttl.onExpire !== 'function') { throw new TypeError(`The "onExpire" property of the "ttl" object (when provided) must be a function, but instead got ${typeof ttl.onExpire}`) }
                                (configs.ttl as TTLKVOptions).onExpire = ttl.onExpire;
                            }
                        }
                    }

                    if (hasOwnProperty(options, 'storeIn')) {
                        const isString = atomix.valueIs.string(options.storeIn);
                        const isArray = atomix.valueIs.array(options.storeIn);

                        if (!(isString || isArray)) {
                            throw new TypeError(`The "storeIn" property of the "options" object (when provided) must be a string or an array of strings, but instead got ${typeof options.storeIn}`);
                        }

                        const enginesInput: string[] = [];
                        if (isString) {
                            enginesInput.push(options.storeIn as string)
                        } else {
                            enginesInput.push(...(options.storeIn as string[]));
                        }

                        for (const engine of enginesInput) {
                            if (!atomix.valueIs.string(engine)) { throw new TypeError(`The "storeIn" property of the "options" object (when provided) must be a string or an array of strings, but instead got ${typeof engine}`) }
                            if (engine.length === 0) { throw new RangeError(`The "storeIn" property of the "options" object (when provided) must be a non-empty string or an array of non-empty strings`) }
                            if (!enginesManager.hasEngine(engine)) {
                                throw new Error(`The "storeIn" property of the "options" object (when provided) must be a string or an array of strings, but the engine "${engine}" is not defined.`);
                            }
                        }

                        configs.storeIn = enginesInput;
                    }

                    return configs;
                },

                preloadOptions: {
                    warmup: (options: KVPreloadWarmupSetOptions, normalConfigs: KVNormalSetConfigs): KVPreloadWarmupSetConfigs => {
                        const { preload: _, ...rest } = normalConfigs;
                        const configs: KVPreloadWarmupSetConfigs = {
                            initiator: 'warmup',
                            preload: true,
                            ...rest,
                        }

                        return configs;
                    },

                    restore: (options: KVPreloadRestoreSetOptions, normalConfigs: KVNormalSetConfigs): KVPreloadRestoreSetConfigs => {
                        const { preload: _, ...rest } = normalConfigs;
                        for (const key in rest) {
                            if (!hasOwnProperty(rest, key)) { throw new SyntaxError(`The preload restore options object must have a "${key}" property`) }
                        }

                        const configs: KVPreloadRestoreSetConfigs = {
                            initiator: 'restore',
                            preload: true,
                            ...rest,
                            stats: {
                                dates: {
                                    created: 0,
                                    expireAt: undefined as number | undefined,
                                    lastAccess: undefined as number | undefined,
                                    lastUpdate: undefined as number | undefined
                                },
                                counts: {
                                    read: 0,
                                    update: 0,
                                    touch: 0,
                                    hit: 0,
                                    miss: 0
                                }
                            }
                        }

                        const assertPositiveInteger = utils.assert.type.positiveInteger;

                        if (hasOwnProperty(options, 'stats')) {
                            if (!atomix.valueIs.record(options.stats)) { throw new TypeError(`The "stats" property of the "options" object (when provided) must be an object, but instead got ${typeof options.stats}`) }

                            if (hasOwnProperty(options.stats, 'dates')) {
                                const dates = options.stats.dates;
                                if (!atomix.valueIs.record(dates)) { throw new TypeError(`The "dates" property of the "stats" object (when provided) must be an object, but instead got ${typeof dates}`) }

                                if (hasOwnProperty(dates, 'created')) {
                                    assertPositiveInteger(dates.created, 'created', 'stats.dates');
                                    configs.stats.dates.created = dates.created;
                                } else {
                                    throw new SyntaxError(`The "created" property of the "dates" property of the "stats" object (when provided) is required when "preload" is true`);
                                }

                                if (hasOwnProperty(dates, 'lastAccess')) {
                                    if (dates.lastAccess !== undefined) { assertPositiveInteger(dates.lastAccess, 'lastAccess', 'stats.dates') }
                                    configs.stats.dates.lastAccess = dates.lastAccess;
                                }

                                if (hasOwnProperty(dates, 'lastUpdate')) {
                                    if (dates.lastUpdate !== undefined) { assertPositiveInteger(dates.lastUpdate, 'lastUpdate', 'stats.dates') }
                                    configs.stats.dates.lastUpdate = dates.lastUpdate;
                                }

                                if (hasOwnProperty(dates, 'expireAt')) {
                                    if (dates.expireAt !== undefined) { assertPositiveInteger(dates.expireAt, 'expireAt', 'stats.dates') }
                                    configs.stats.dates.expireAt = dates.expireAt;
                                }
                            } else {
                                throw new SyntaxError(`The "dates" property of the "stats" object (when provided) is required when "preload" is true`)
                            }

                            if (hasOwnProperty(options.stats, 'counts')) {
                                const counts = options.stats.counts;
                                if (!atomix.valueIs.record(counts)) { throw new TypeError(`The "counts" property of the "stats" object (when provided) must be an object, but instead got ${typeof counts}`) }

                                if (hasOwnProperty(counts, 'read')) {
                                    assertPositiveInteger(counts.read, 'read', 'stats.counts');
                                    configs.stats.counts.read = counts.read;
                                } else {
                                    throw new SyntaxError(`The "read" property of the "counts" property of the "stats" object (when provided) is required when "preload" is true`);
                                }

                                if (hasOwnProperty(counts, 'update')) {
                                    assertPositiveInteger(counts.update, 'update', 'stats.counts');
                                    configs.stats.counts.update = counts.update;
                                } else {
                                    throw new SyntaxError(`The "update" property of the "counts" property of the "stats" object (when provided) is required when "preload" is true`);
                                }

                                if (hasOwnProperty(counts, 'touch')) {
                                    assertPositiveInteger(counts.touch, 'touch', 'stats.counts');
                                    configs.stats.counts.touch = counts.touch;
                                } else {
                                    throw new SyntaxError(`The "touch" property of the "counts" property of the "stats" object (when provided) is required when "preload" is true`);
                                }

                                if (hasOwnProperty(counts, 'hit')) {
                                    assertPositiveInteger(counts.hit, 'hit', 'stats.counts');
                                    configs.stats.counts.hit = counts.hit;
                                } else {
                                    throw new SyntaxError(`The "hit" property of the "counts" property of the "stats" object (when provided) is required when "preload" is true`);
                                }

                                if (hasOwnProperty(counts, 'miss')) {
                                    assertPositiveInteger(counts.miss, 'miss', 'stats.counts');
                                    configs.stats.counts.miss = counts.miss;
                                } else {
                                    throw new SyntaxError(`The "miss" property of the "counts" property of the "stats" object (when provided) is required when "preload" is true`);
                                }
                            } else {
                                throw new SyntaxError(`The "counts" property of the "stats" object (when provided) is required when "preload" is true`)
                            }
                        } else {
                            throw new SyntaxError(`The "stats" property of the "options" object (when provided) must be an object, but instead got ${typeof options.stats}`)
                        }

                        return configs;
                    },

                    any: (options: KVPreloadSetConfigs, normalConfigs: KVNormalSetConfigs) => {
                        const { preload: _, ttl, ...rest } = normalConfigs;

                        const initiator = options.initiator;
                        switch (initiator) {
                            case 'restore':
                                return this.#_helpers.validate.set.preloadOptions.restore(options, normalConfigs);

                            case 'warmup':
                                return this.#_helpers.validate.set.preloadOptions.warmup(options, normalConfigs);

                            default:
                                throw new SyntaxError(`The "initiator" property of the "options" object (when provided) must be either ${constants.CACHE_PRELOAD_INITIATORS.map(i => `"${i}"`).join(', ')} when "preload" is true, but instead got "${initiator}"`);
                        }
                    }
                }
            }
        }
    }

    readonly validate = {
        setOptions: (configs: KVCacheConfig, options?: KVSetOptions) => {
            if (options === undefined) { return this.#_defaults.setConfigs(configs) }

            if (!atomix.valueIs.record(options)) { throw new TypeError(`The "options" parameter (when provided) must be an object, but instead got ${typeof options}`) }

            let preload = false;
            if (hasOwnProperty(options, 'preload')) {
                if (typeof options.preload !== 'boolean') { throw new TypeError(`The "preload" property of the "options" object (when provided) must be a boolean, but instead got ${typeof options.preload}`) }
                preload = options.preload;

                if (options.preload) {
                    if (hasOwnProperty(options, 'initiator')) {
                        const initiator = options.initiator;
                        if (!atomix.valueIs.string(initiator)) { throw new TypeError(`The "initiator" property of the "options" object (when provided) must be a string, but instead got ${typeof initiator}`) }
                        if (!constants.CACHE_PRELOAD_INITIATORS.includes(initiator as CachePreloadInitiator)) { throw new RangeError(`The "initiator" property of the "options" object (when provided) must be one of the following values: ${constants.CACHE_PRELOAD_INITIATORS.join(', ')}, but instead got "${initiator}".`) }
                    } else {
                        throw new SyntaxError(`The "source" property of the "options" object (when provided) is required when "preload" is true`);
                    }
                }
            }

            const validate = this.#_helpers.validate.set;

            const normalConfigs = validate.normalOptions(options as KVNormalSetConfigs, configs);
            return preload ? validate.preloadOptions.any(options as unknown as KVPreloadSetConfigs, normalConfigs) : normalConfigs;
        }
    }
}

const kvHelpers = new KVHelpers();
export default kvHelpers;