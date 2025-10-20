import cachify from "../../../src/cachify";
import overwatch from "@nasriya/overwatch";
import cron from "@nasriya/cron";
import path from 'path';
import fs from 'fs';
import os from 'os';
import { BenchmarkName, BenchmarkStage, BenchmarkStats, MainBenchmarkAnalytics, MainBenchmarkResults, StageName, StagePromisePayload, TEST_DIR, TestReturnAnalytics, TestReturnType } from "../setup";
import ConsoleX from '../../helpers/console'

const configs = getConfig();
export const consoleX = new ConsoleX({
    storeJSON: true,
    storeOutput: true,
    outDir: configs.out_dir
});

export function getConfig() {
    const BENCHMARK_KV_COUNT = parseInt(process.env.BENCHMARK_KV_COUNT || '') || 100_000;
    const BENCHMARK_FILES_COUNT = parseInt(process.env.BENCHMARK_FILES_COUNT || '') || 1000;
    const BENCHMARK_OUT_DIR = process.env.BENCHMARK_OUT_DIR || path.resolve(process.cwd(), 'benchmarks');

    return {
        kv_records_count: BENCHMARK_KV_COUNT,
        file_count: BENCHMARK_FILES_COUNT,
        out_dir: BENCHMARK_OUT_DIR
    }
}

export function getSystemInfo() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
        platform: os.platform(),             // 'linux', 'win32', etc.
        arch: os.arch(),                     // 'x64', 'arm64', etc.
        release: os.release(),               // OS version
        uptime: os.uptime(),                 // in seconds

        cpu: {
            model: cpus[0].model,
            speed: cpus[0].speed,            // MHz
            cores: cpus.length
        },

        memory: {
            total: `${(totalMem / 1024 ** 3).toFixed(2)} GB`,
            free: `${(freeMem / 1024 ** 3).toFixed(2)} GB`,
            used: `${((totalMem - freeMem) / 1024 ** 3).toFixed(2)} GB`
        },
    };
}

export function generateTestAction<F extends (...args: any[]) => Promise<any>>(test: F, tag: string): (...args: Parameters<F>) => Promise<ReturnType<F>> {
    const task = async (...args: Parameters<F>): Promise<ReturnType<F>> => {
        consoleX.time({ id: `benchmark_${tag}`, title: `Running the [${tag}] benchmark`, tag: tag });
        try {
            const results = await test(...args);
            return results;
        } catch (error) {
            throw error;
        } finally {
            consoleX.timeEnd(`benchmark_${tag}`);
            consoleX.log('');
        }
    };

    return task;
}

async function cleanup() {
    await Promise.all([
        cachify.clear(),
        cron.destroy(),
        consoleX.flush(),
        fs.promises.rm(TEST_DIR, { recursive: true, force: true })
    ])
    overwatch.control.pause();
    process.exit(0);
}

function collectBenchmarkStats<T extends BenchmarkStage>(
    stage: T,
    results: PromiseSettledResult<StagePromisePayload<T>>[]
): BenchmarkStats<T> {
    let fastest = Infinity;
    let slowest = -Infinity;
    let totalDuration = 0;
    let succeeded = 0;
    let failed = 0;

    for (const result of results) {
        if (result.status === 'fulfilled') {
            const { startTime, endTime } = result.value;
            const duration = endTime - startTime;

            fastest = Math.min(fastest, duration);
            slowest = Math.max(slowest, duration);
            totalDuration += duration;
            succeeded++;
        } else {
            failed++;
        }
    }

    return {
        stage,
        fastest: fastest === Infinity ? 0 : fastest,
        slowest: slowest === -Infinity ? 0 : slowest,
        average: succeeded > 0 ? totalDuration / succeeded : 0,
        succeeded,
        failed,
        total: succeeded + failed,
    };
}

async function storeResults(analyticsRes: MainBenchmarkAnalytics) {
    const configs = getConfig();

    // Store the analytics results in a file
    const resultsFile = path.join(configs.out_dir, 'results.json');
    await fs.promises.writeFile(resultsFile, JSON.stringify(analyticsRes, null, 4));
}

async function analyzeResults(execResults: MainBenchmarkResults) {
    const analyticsResults: MainBenchmarkAnalytics = {};

    const convertReturnType = (value: TestReturnType): TestReturnAnalytics => {
        const obj: TestReturnAnalytics = {
            store: value.store,
            tests: (() => {
                const tests: Record<string, BenchmarkStats> = {};
                for (const [stageName, taskRes] of Object.entries(value.tests)) {
                    tests[stageName] = helpers.collectBenchmarkStats(stageName, taskRes);
                }

                return tests
            })()
        }

        return obj;
    }


    for (const [benchName, benchRes] of Object.entries(execResults)) {
        // Create the analytics object for the benchmark
        const benchmarkAnalytics: MainBenchmarkAnalytics = analyticsResults[benchName as BenchmarkName] = {};

        for (const [taskName, taskRes] of Object.entries(benchRes)) {
            // Create the analytics object for the task
            benchmarkAnalytics[taskName as BenchmarkName] = convertReturnType(taskRes);
        }
    }

    await storeResults(analyticsResults);
    return analyticsResults
}

const helpers = { generateTestAction, getConfig, cleanup, collectBenchmarkStats, analyzeResults, getSystemInfo };
export default helpers;


