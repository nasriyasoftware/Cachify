import fs from 'fs';
import path from 'path';
import cachify from "../../../../src/cachify";
import helpers, { consoleX, generateTestAction } from "../../assets/helpers";
import { BenchmarkName, BenchMeta, StageName, StagePromisePayload, TEST_DIR, TestReturnType, FILE_CONTENT } from "../../setup";
import filesystem from '../../../../src/core/memory/files/filesystem';

const locals = Object.freeze({
    TEST_FILE_PATH: path.join(TEST_DIR, 'cachify-benchmark.txt'),
})

export async function setup() {
    await fs.promises.rm(TEST_DIR, { recursive: true, force: true });
    await fs.promises.mkdir(TEST_DIR, { recursive: true });
    await filesystem.writeFile(locals.TEST_FILE_PATH, FILE_CONTENT);

    cachify.files.configs.maxFileSize = 1024 * 1024 * 10; // 10 MB
    cachify.files.configs.maxTotalSize = 1024 * 1024 * 50; // 50 MB

    for (let i = 0; i < helpers.getConfig().file_count; i++) {
        const filePath = path.join(TEST_DIR, `cachify-benchmark-${i}.txt`);
        await filesystem.writeFile(filePath, FILE_CONTENT);
    }
}

// --- Files benchmark core ---
export async function bench_core(records: number, storeIn: ('memory' | 'redis')[]) {
    const TAG = `[FILES][${storeIn.join(' | ')}]`;
    const results: TestReturnType = {
        store: storeIn,
        tests: {}
    }

    // --- Set files ---
    consoleX.time({ id: 'create_set_file_promises', title: `${TAG} Creating SET promises...`, tag: 'SET Promises' });
    const setPromises: Promise<StagePromisePayload<'set'>>[] = [];
    for (let i = 0; i < records; i++) {
        setPromises.push(new Promise((resolve, reject) => {
            const response: StagePromisePayload<'set'> = {
                stage: 'set',
                index: i,
                startTime: Date.now(),
                endTime: 0
            }

            // Use a copy of the test file
            const filePath = path.join(TEST_DIR, `cachify-benchmark-${i}.txt`);
            cachify.files.set(filePath, { storeIn }).then(() => {
                response.endTime = Date.now();
                resolve(response);
            }).catch((err) => {
                response.endTime = Date.now();
                // @ts-ignore
                response.error = err;
                reject(response);
            })
        }));
    }
    consoleX.timeEnd('create_set_file_promises');

    consoleX.time({ id: 'execute_set_file_promises', title: `${TAG} Writing files...`, tag: 'SET' });
    results.tests['set'] = await Promise.allSettled(setPromises);
    consoleX.timeEnd('execute_set_file_promises');


    for (const state of ['cold', 'hot'] as const) {
        consoleX.time({ id: `create_get_file_${state}_promises`, title: `${TAG} Creating ${state.toUpperCase()} GET promises...`, tag: 'GET Promises' });
        const getPromises: Promise<StagePromisePayload<`${typeof state}_read`>>[] = [];

        for (let i = 0; i < records; i++) {
            getPromises.push(new Promise((resolve, reject) => {
                const response: StagePromisePayload<`${typeof state}_read`> = {
                    stage: `${state}_read`,
                    index: i,
                    startTime: Date.now(),
                    endTime: 0
                };

                const filePath = path.join(TEST_DIR, `cachify-benchmark-${i}.txt`);
                cachify.files.read({ filePath }).then(() => {
                    response.endTime = Date.now();
                    resolve(response);
                }).catch((err) => {
                    response.endTime = Date.now();
                    // @ts-ignore
                    response.error = err;
                    reject(response);
                });
            }));
        }
        consoleX.timeEnd(`create_get_file_${state}_promises`);

        consoleX.time({ id: `execute_get_file_${state}_promises`, title: `${TAG} Reading files...`, tag: 'GET' });
        const res = await Promise.allSettled(getPromises);
        results.tests[`${state}_read`] = res;
        consoleX.timeEnd(`execute_get_file_${state}_promises`);
    }


    return results;
}

// --- Files benchmark wrapper ---
async function benchmark(records: number, storeIn: ('memory' | 'redis')[]) {
    const benchmark_msg = `[FILES] Finished writing ${records} files.`;
    console.log(`[FILES] Benchmarking ${records} files in ${storeIn.join('-')}...`);

    try {
        const result = await bench_core(records, storeIn);
        return result;
    } catch (error) {
        throw error;
    } finally {
        // console.timeEnd(benchmark_msg);
        // console.groupEnd();
    }
}

// --- Meta generator for Files ---
export function getBenchmarkMeta(recordsCount: number): BenchMeta {
    const results: Record<string, any> = {};
    const tasks: typeof tasksData.memory.meta[] = [];

    const tasksData = {
        memory: {
            meta: {
                type: 'files_memory' as StageName,
                action: () => {
                    const test = generateTestAction(benchmark, 'files_memory');
                    return test(recordsCount, ['memory']);
                },
                onResolve: (res) => { results['memory'] = res },
                onReject: (err) => console.error(err),
                onDone: async () => { await globalFilesOnDone(); }
            },
            add() { tasks.push(this.meta); results['memory'] = {}; }
        },
        redis: {
            meta: {
                type: 'files_redis' as StageName,
                action: () => {
                    const test = generateTestAction(benchmark, 'files_redis');
                    return test(recordsCount, ['redis']);
                },
                onResolve: (res) => { results['redis'] = res },
                onReject: (err) => console.error(err),
                onDone: async () => { await globalFilesOnDone(); }
            },
            add() { tasks.push(this.meta); results['redis'] = {}; }
        },
        hybrid: {
            meta: {
                type: 'files_memory_redis' as StageName,
                action: () => {
                    const test = generateTestAction(benchmark, 'files_memory_redis');
                    return test(recordsCount, ['memory', 'redis']);
                },
                onResolve: (res) => { results['hybrid'] = res },
                onReject: (err) => console.error(err),
                onDone: async () => { await globalFilesOnDone(); }
            },
            add() { tasks.push(this.meta); results['hybrid'] = {}; }
        }
    }

    tasksData.memory.add();
    if (process.env.REDIS_BENCHMARK_URL) {
        tasksData.redis.add();
        tasksData.hybrid.add();
    }

    return {
        testName: 'FILES' as BenchmarkName,
        tasks,
        resultsReference: results,
        setup
    }
}

async function globalFilesOnDone() {
    consoleX.log(`[FILES] Cache Stats:`, { logToConsole: false });
    consoleX.dir(cachify.files.stats, { logToConsole: false });
    consoleX.predefined.diver('-', { logToConsole: false });
    consoleX.log('');
    await cachify.clear();
}
