import cachify from "../../cachify";
import Engines from "./Engines";
import EngineError from "./EngineError";
import { TasksQueue } from "@nasriya/atomix/tools";
import type { CacheRecord } from "../docs/docs";
import type { Brand, Prettify } from "@nasriya/atomix";

type IoOps = 'read' | 'set' | 'remove';
type QueueKey = Brand<string, 'queueKey'>;
type LeacherKey = `${IoOps}_${QueueKey}`;
type EngineResponse = { source: string; value: any };
type LeacherReadResolver = (response: EngineResponse) => void;
type LeacherRejecter = (error: Error) => void;
type LeacherReadResult = Prettify<({ ok: true, response: EngineResponse } | { ok: false, error: Error }) & { record: CacheRecord }>;
type LeacherGeneralResult = Prettify<({ ok: true } | { ok: false, error: Error }) & { record: CacheRecord }>;

type LeacherResults = {
    [K in IoOps]: K extends 'read' ? LeacherReadResult : LeacherGeneralResult;
}

interface Leacher<IoOps> {
    reject: LeacherRejecter;
    resolve: IoOps extends 'read' ? LeacherReadResolver : () => void;
}

class EnginesProxy {
    readonly #_queues: Map<QueueKey, TasksQueue> = new Map();
    readonly #_leachers: Map<LeacherKey, Leacher<IoOps>[]> = new Map();
    readonly #_engines: Engines;

    constructor(engines: Engines) { this.#_engines = engines }

    readonly #_helpers = {
        getTaskQueue: (key: QueueKey) => {
            const queue = this.#_queues.get(key);
            if (queue) { return queue; }

            const newQueue = new TasksQueue({ autoRun: true });
            this.#_queues.set(key, newQueue);
            return newQueue;
        },
        getLeachersMap: (key: LeacherKey) => {
            const leachers = this.#_leachers.get(key);
            if (leachers) { return leachers; }

            const newLeachers: Leacher<IoOps>[] = [];
            this.#_leachers.set(key, newLeachers);
            return newLeachers;
        },
        respondToLeachers: <Op extends IoOps>(op: Op, result: LeacherResults[Op]) => {
            const leacherKey: LeacherKey = `${op}_${result.record.key as QueueKey}`;
            if (!this.#_leachers.has(leacherKey)) { return }

            // Take a copy of the leachers array
            const leachers: Leacher<Op>[] = this.#_leachers.get(leacherKey)!;

            // Clears the leachers array for data consistency
            this.#_leachers.delete(leacherKey);

            // ✅ Debug log goes here
            if (cachify.debug) {
                console.debug(`[Cachify:Leachers] Resolving ${leachers.length} leacher(s) for "${leacherKey}" (${result.ok ? 'success' : 'error'})`);
            }

            // Respond to the leachers
            for (const leacher of leachers) {
                try {
                    if (result.ok === true) {
                        switch (op) {
                            case 'read': {
                                (leacher as Leacher<'read'>).resolve((result as any).response);
                            }

                            case 'remove':
                            case 'set': {
                                (leacher as Leacher<'remove' | 'set'>).resolve();
                            }
                        }
                    } else {
                        leacher.reject(result.error);
                    }
                } catch (error) {
                    // Ignore or log the error if debugging
                    if (cachify.debug) {
                        console.debug(`[Cachify:Leachers] Failed to resolve leacher for "${leacherKey}":`, error);
                    }
                }
            }
        }
    }

    /**
     * Sets the value for a given cache record across multiple engines.
     *
     * This method attempts to set a value for a cache record in all specified engines.
     * If any engine fails to set the value, it will attempt to remove the record
     * from any engines where the set operation was successful, to maintain consistency.
     *
     * @param {CacheRecord} record - The cache record to set the value for.
     * @param {any} value - The value to set for the cache record.
     * @throws {Error} Throws an error if setting the value fails for one or more engines.
     * The error contains a summary of which engines failed and why.
     * @returns {Promise<void>} A promise that resolves when the value is set or rejects with an error if any engine fails.
     */
    async set(record: CacheRecord, value: unknown): Promise<void> {
        const setPromises: Promise<any>[] = [];
        for (const engineName of record.engines) {
            const engine = this.#_engines.getEngine(engineName)!;
            setPromises.push(engine.set(record, value).then(() => engineName).catch((err) => Promise.reject({ engineName, error: err })));
        }

        const results = await Promise.allSettled(setPromises);
        const errors: { engineName: string; error: any }[] = results.filter(i => i.status === 'rejected').map(i => (i as PromiseRejectedResult).reason);

        if (errors.length > 0) {
            const successfulEngines = results.filter(i => i.status === 'fulfilled').map(i => (i as PromiseFulfilledResult<string>).value);

            await Promise.all(successfulEngines.map(engineName => {
                const engine = this.#_engines.getEngine(engineName)!;
                return engine.remove(record);
            }));

            const error = new Error(`Failed to set record "${record.key}"`);
            error.cause = errors;
            (error as any).summary = errors.map(e => `- ${e.engineName}: ${e.error?.message || e.error}`).join('\n');
            throw error;
        }
    }

    /**
     * Attempts to remove a cache record from all engines associated with it.
     *
     * This method runs the `remove` operation across all engines listed in the
     * record's `engines` array. If all engines fail to remove the record,
     * an error is thrown containing details about each failure.
     *
     * If some engines succeed and others fail, the method completes without throwing,
     * but logs a warning if `cachify.debug` is enabled.
     *
     * Each removal is handled independently using `Promise.allSettled` to ensure
     * one failing engine does not block others.
     *
     * @param {CacheRecord} record - The cache record to remove from each engine.
     * @returns {Promise<void>} Resolves if at least one engine successfully removes the record.
     * Throws an error if all engines fail.
     *
     * @throws {Error} If all engine removals fail. The thrown error includes a `.cause`
     * array listing all individual engine errors, and a `.summary` string for human-readable output.
     *
     * @example
     * try {
     *   await engineProxy.remove(record);
     * } catch (error) {
     *   console.error('Failed to remove record from all engines:', error.summary);
     * }
     *
     * @since v1.0.0
     */
    async remove(record: CacheRecord): Promise<void> {
        // Defensive: If already gone, return immediately
        if (!record) { return }

        const queue = this.#_helpers.getTaskQueue(record.key as QueueKey);
        const taskId = `remove_${record.key as QueueKey}`;

        if (queue.hasTask(taskId)) {
            const leacherKey: LeacherKey = `remove_${record.key as QueueKey}`;
            const leachers = this.#_helpers.getLeachersMap(leacherKey);
            return new Promise<void>((resolve, reject) => {
                leachers.push({
                    resolve: () => resolve(),
                    reject: (error: Error) => reject(error)
                });
            });
        }

        return new Promise<void>((resolve, reject) => {
            queue.addTask({
                id: taskId,
                type: 'remove',
                priority: 1,
                action: async () => {
                    const debug = cachify.debug;

                    const removePromises: Promise<any>[] = record.engines.map(engineName => {
                        const engine = this.#_engines.getEngine(engineName)!;

                        return new Promise<string>((engineResolver, engineRejecter) => {
                            engine.remove(record).then(() => engineResolver(engineName)).catch(err => {
                                if (debug) console.debug(`Failed to remove from engine "${engineName}":`, err);
                                engineRejecter({ engineName, error: err });
                            })
                        })
                    });

                    const results = await Promise.allSettled(removePromises);
                    const errors: { engineName: string; error: any }[] = results.filter(i => i.status === 'rejected').map(i => (i as PromiseRejectedResult).reason);
                    const allFailed = errors.length === record.engines.length;
                    const summary = errors.length > 0 ? errors.map(e => {
                        return `- ${e.engineName}: ${e.error?.message || e.error}`
                    }).join('\n') : '';

                    if (allFailed) {
                        const error = new EngineError(`Failed to remove record "${record.key}" from all engines.`);
                        error.errors = errors;
                        error.cause = summary;

                        throw error;
                    }

                    if (errors.length > 0 && debug) {
                        console.debug(`Failed to remove record "${record.key}" from engines:\n${summary}`);
                    }
                },
                onResolve: () => {
                    this.#_helpers.respondToLeachers('remove', { ok: true, record });
                    resolve();
                },
                onReject: (err) => {
                    this.#_helpers.respondToLeachers('remove', { ok: false, error: err, record });
                    reject(err);
                }
            })
        })
    }

    /**
     * Retrieves the value associated with the given cache record key.
     * This method attempts to read the value from all specified engines and
     * returns the value from the first engine that responds with a value.
     * If all engines respond with undefined, it returns a response with
     * undefined as the value.
     * If any engine fails to read the value, it will attempt to read the
     * value from other engines and return the value from the first engine
     * that responds with a value. If all engines fail to read the value, it
     * throws an error with a summary of which engines failed and why.
     *
     * @param record - The cache record to retrieve the value for.
     * @returns A promise that resolves with the value associated with the cache record.
     * @throws {Error} Throws an error if reading the value fails for one or more engines.
     * The error contains a summary of which engines failed and why.
     * @since v1.0.0
     */
    async read(record: CacheRecord): Promise<EngineResponse> {
        const queue = this.#_helpers.getTaskQueue(record.key as QueueKey);
        const taskId = `read_${record.key as QueueKey}`;

        if (queue.hasTask(taskId)) {
            const leacherKey: LeacherKey = `read_${record.key as QueueKey}`;
            const leachers = this.#_helpers.getLeachersMap(leacherKey);
            return new Promise<EngineResponse>((resolve, reject) => {
                leachers.push({
                    resolve: (response: EngineResponse) => resolve(response),
                    reject: (error: Error) => reject(error)
                });
            });
        }

        return new Promise<EngineResponse>((resolve, reject) => {
            queue.addTask({
                id: `read_${record.key as QueueKey}`,
                type: 'read',
                priority: 0,
                action: async () => {
                    const debug = cachify.debug;
                    const hasMemoryEngine = record.engines.includes('memory');

                    if (hasMemoryEngine) {
                        const memoryEngine = this.#_engines.getEngine('memory')!;
                        const value = await memoryEngine.read(record);
                        if (debug) { console.debug(`Read from memory engine:`, value); }
                        if (value !== undefined) { return { source: 'memory', value } }
                    }

                    const readPromises: Promise<EngineResponse>[] = record.engines.filter(engineName => engineName !== 'memory').map(engineName => {
                        const engine = this.#_engines.getEngine(engineName)!;

                        return new Promise((engineResolver, engineRejecter) => {
                            engine.read(record).then(value => {
                                if (value !== undefined) {
                                    engineResolver({ source: engineName, value })
                                } else {
                                    if (debug) console.debug(`Engine "${engineName}" returned undefined.`);
                                    const error = new EngineError(`Engine "${engineName}" returned undefined.`);
                                    error.cause = 'ENGINE_UNDEFINED_VALUE';
                                    engineRejecter(error);
                                }
                            }).catch(err => {
                                if (debug) console.debug(`Failed to read from engine "${engineName}":`, err);
                                const error = new EngineError(`Failed to read from engine "${engineName}": ${err.message || err}`);
                                error.errors = [err];
                                engineRejecter(error);
                            });
                        });
                    });

                    try {
                        const response = await Promise.any(readPromises);
                        if (debug) { console.debug(`Read from engine "${response.source}":`, response.value); }
                        return response;
                    } catch (mainError) {
                        if (mainError instanceof AggregateError) {
                            const errors = mainError.errors;

                            const isUndefinedValueError = (err: unknown): err is EngineError => err instanceof EngineError && err.cause === 'ENGINE_UNDEFINED_VALUE';
                            const undefinedValueErrors = errors.filter(isUndefinedValueError);

                            if (undefinedValueErrors.length === errors.length) {
                                if (debug) console.debug(`All engines returned undefined.`);
                                const response: EngineResponse = { source: 'proxy', value: undefined };
                                return resolve(response)
                            }

                            const filteredErrors = errors.filter(err => !isUndefinedValueError(err));

                            const aggregate = new AggregateError(
                                filteredErrors,
                                `Failed to read record "${record.key}": all engines failed.`
                            );

                            throw aggregate;
                        }

                        throw mainError;
                    }
                },
                onResolve: (res) => {
                    this.#_helpers.respondToLeachers('read', { ok: true, response: res, record });
                    resolve(res);
                },
                onReject: (err) => {
                    this.#_helpers.respondToLeachers('read', { ok: false, error: err, record });
                    reject(err);
                }
            })
        })
    }

    /**
     * Retrieves the list of engines associated with the proxy.
     * @returns The list of engines associated with the proxy.
     * @since v1.0.0
     */
    get engines(): Engines { return this.#_engines }
}

export default EnginesProxy;