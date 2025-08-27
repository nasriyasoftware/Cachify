import cachify from "../../../../src/cachify";
import { consoleX, generateTestAction } from "../../assets/helpers";
import { BenchmarkName, BenchMeta, StageName, StagePromisePayload, TestReturnType } from "../../setup";

export async function setup() {
    cachify.kv.configs.eviction.maxRecords = Infinity;
}

export async function bench_core(records: number, storeIn: ('memory' | 'redis')[]) {
    const TAG = `[KV][${storeIn.join(' | ')}]`;
    const results: TestReturnType = {
        store: storeIn,
        tests: {}
    }

    const encodedStoreInValue = storeIn.join('-');
    const encodedStoreInKey = encodedStoreInValue;
    {
        consoleX.time({ id: 'creaet_set_promises', title: `${TAG} Creating SET promises...`, tag: 'SET Promises' });
        const setPromises: Promise<StagePromisePayload<'set'>>[] = [];
        for (let i = 0; i < records; i++) {
            setPromises.push(
                new Promise<StagePromisePayload<'set'>>((resolve, reject) => {
                    const response = {
                        stage: 'set' as const,
                        index: i,
                        startTime: Date.now(),
                        endTime: 0,
                    }

                    cachify.kv.set(`key-${encodedStoreInKey}-${i}`, `value-${encodedStoreInValue}-${i}`, { storeIn: storeIn }).then(() => {
                        response.endTime = Date.now();
                        resolve(response);
                    }).catch((err) => {
                        response.endTime = Date.now();
                        // @ts-ignore
                        response.error = err;
                        reject(response);
                    })
                })
            )
        }
        consoleX.timeEnd('creaet_set_promises');

        consoleX.time({ id: 'execute_set_promises', title: `${TAG} Setting values...`, tag: 'SET' });
        results.tests['set'] = await Promise.allSettled(setPromises);
        consoleX.timeEnd('execute_set_promises');
    }

    {
        consoleX.time({ id: 'creaet_get_promises', title: `${TAG} Creating GET promises...`, tag: 'GET Promises' });
        const getPromises: Promise<StagePromisePayload<'hot_read'>>[] = [];
        for (let i = 0; i < records; i++) {
            getPromises.push(
                new Promise<StagePromisePayload<'hot_read'>>((resolve, reject) => {
                    const response = {
                        stage: 'hot_read' as const,
                        index: i,
                        startTime: Date.now(),
                        endTime: 0,
                    }

                    cachify.kv.get(`key-${encodedStoreInKey}-${i}`).then(() => {
                        response.endTime = Date.now();
                        resolve(response);
                    }).catch((err) => {
                        response.endTime = Date.now();
                        // @ts-ignore
                        response.error = err;
                        reject(response);
                    })
                })
            )
        }
        consoleX.timeEnd('creaet_get_promises');

        consoleX.time({ id: 'execute_get_promises', title: `${TAG} Getting values...`, tag: 'GET' });
        results.tests['read'] = await Promise.allSettled(getPromises);
        consoleX.timeEnd('execute_get_promises');
    }

    return results
}

async function benchmark(records: number, storeIn: ('memory' | 'redis')[]) {
    const benchmark_msg = `[KV] Finished writing ${records} records.`;
    console.log(`[KV] Benchmarking ${records} records in ${storeIn.join('-')}...`)
    // console.group(`[KV] Benchmarking ${records} records...`);

    try {
        // console.time(benchmark_msg);
        const result = await bench_core(records, storeIn);
        return result;
    } catch (error) {
        throw error;
    } finally {
        // console.timeEnd(benchmark_msg);
        // console.groupEnd();
    }
}

export function getBenchmarkMeta(recordsCount: number): BenchMeta {
    const results: Record<string, any> = {};
    const tasks = [] as typeof tasksData.memory.meta[];
    const tasksData = {
        memory: {
            meta: {
                type: 'kv_memory' as StageName,
                action: () => {
                    const test = generateTestAction(benchmark, 'kv_memory');
                    return test(recordsCount, ['memory']);
                },
                onResolve: (res) => {
                    results['memory'] = res;
                },
                onReject: (error) => {
                    console.error(error);
                },
                onDone: async () => {
                    await globalOnDone();
                }
            },
            add() {
                tasks.push(this.meta);
                results['memory'] = {};
            }
        },
        redis: {
            meta: {
                type: 'kv_redis' as StageName,
                action: () => {
                    const test = generateTestAction(benchmark, 'kv_redis');
                    return test(recordsCount, ['redis']);
                },
                onResolve: (res) => {
                    results['redis'] = res;
                },
                onReject: (error) => {
                    console.error(error);
                },
                onDone: async () => {
                    await globalOnDone();
                }
            },
            add() {
                tasks.push(this.meta);
                results['redis'] = {};
            }
        },
        hybrid: {
            meta: {
                type: 'kv_redis_memory' as StageName,
                action: () => {
                    const test = generateTestAction(benchmark, 'kv_redis_memory');
                    return test(recordsCount, ['memory', 'redis']);
                },
                onResolve: (res) => {
                    results['hybrid'] = res;
                },
                onReject: (error) => {
                    console.error(error);
                },
                onDone: async () => {
                    await globalOnDone();
                }
            },
            add() {
                tasks.push(this.meta);
                results['hybrid'] = {};
            }
        }
    }

    tasksData.memory.add();
    if (process.env.REDIS_BENCHMARK_URL) {
        tasksData.redis.add();
        tasksData.hybrid.add();
    }

    return {
        testName: 'KV' as BenchmarkName,
        tasks: tasks,
        resultsReference: results,
        setup
    }
}

async function globalOnDone() {
    consoleX.log(`[KV] Cache Stats:`, { logToConsole: false });
    consoleX.dir(cachify.kv.stats, { logToConsole: false });
    consoleX.predefined.diver('-', { logToConsole: false });
    consoleX.log('');
    await cachify.clear();
}