import type { StageReturnType, TestName, StageStats, TaskName, StageName, StageAnalytics, TestAnalytics, TestStageFunction, TestConfigs } from "../docs";
import type { BaseQueueTask } from "@nasriya/atomix";
import type { CacheFlavor } from "../../../src";
import cachify from "../../../src/cachify";
import Benchmark from "./Stage";
import globalConfigs from "../../setup/configs";
import consoleX from "../../setup/console";

class Test<F extends CacheFlavor> {
    readonly #_flavor: F;
    readonly #_name: TestName;
    readonly #_stages: TestStageFunction<CacheFlavor>[];
    readonly #_tasks: BaseQueueTask<StageReturnType>[] = [];
    readonly #_results: Record<StageName, StageReturnType> = {};
    readonly #_analytics: TestAnalytics = {};
    readonly #_setup = async () => { };

    readonly #_helpers = {
        addTask: {
            memory: (tasksToRun: TestStageFunction<CacheFlavor>[]) => {
                const tag = `${this.#_flavor}_memory`;
                const testName = 'memory' as StageName;

                this.#_tasks.push({
                    type: tag,
                    action: async () => {
                        const benchmark = new Benchmark({
                            flavor: this.#_flavor,
                            recordsNumber: globalConfigs.counts[this.#_flavor],
                            storeIn: ['memory'],
                            tasksToRun
                        });

                        const test = this.#_helpers.generateTest(benchmark, tag);
                        return test();
                    },
                    onResolve: (res: StageReturnType) => this.#_results[testName] = res,
                    onReject: (err: Error) => console.error(err),
                    onDone: this.#_helpers.globalOnDone
                })
            },
            redis: (tasksToRun: TestStageFunction<CacheFlavor>[]) => {
                const tag = `${this.#_flavor}_redis`;
                const testName = 'redis' as StageName;

                this.#_tasks.push({
                    type: tag,
                    action: async () => {
                        const benchmark = new Benchmark({
                            flavor: this.#_flavor,
                            recordsNumber: globalConfigs.counts[this.#_flavor],
                            storeIn: ['redis'],
                            tasksToRun
                        });

                        const test = this.#_helpers.generateTest(benchmark, tag);
                        return test();
                    },
                    onResolve: (res: StageReturnType) => this.#_results[testName] = res,
                    onReject: (err: Error) => console.error(err),
                    onDone: this.#_helpers.globalOnDone
                })
            },
            hybrid: (tasksToRun: TestStageFunction<CacheFlavor>[]) => {
                const tag = `${this.#_flavor}_redis_memory`;
                const testName = 'hybrid' as StageName;

                this.#_tasks.push({
                    type: tag,
                    action: async () => {
                        const benchmark = new Benchmark({
                            flavor: this.#_flavor,
                            recordsNumber: globalConfigs.counts[this.#_flavor],
                            storeIn: ['memory', 'redis'],
                            tasksToRun
                        });

                        const test = this.#_helpers.generateTest(benchmark, tag);
                        return test();
                    },
                    onResolve: (res: StageReturnType) => this.#_results[testName] = res,
                    onReject: (err: Error) => console.error(err),
                    onDone: this.#_helpers.globalOnDone
                })
            }
        },
        collectTaskStats: <T extends TaskName>(task: T, miniStageRes: StageReturnType['tasks'][TaskName]): StageStats<T> => {
            let fastest = Infinity;
            let slowest = -Infinity;
            let totalDuration = 0;
            let succeeded = 0;
            let failed = 0;

            for (const result of miniStageRes) {
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
                task,
                fastest: fastest === Infinity ? 0 : fastest,
                slowest: slowest === -Infinity ? 0 : slowest,
                average: succeeded > 0 ? totalDuration / succeeded : 0,
                succeeded,
                failed,
                total: succeeded + failed,
            };
        },
        generateTest: (benchmark: Benchmark<F>, tag: string) => {
            return async (): Promise<StageReturnType> => {
                consoleX.time({ id: `benchmark_${tag}`, title: `Running the [${tag}] benchmark`, tag: tag });
                try {
                    await benchmark.run();
                    return benchmark.results;
                } catch (error) {
                    throw error;
                } finally {
                    consoleX.timeEnd(`benchmark_${tag}`);
                    consoleX.log('');
                }
            }
        },
        globalOnDone: async () => {
            consoleX.log(`[${this.#_flavor.toUpperCase()}] Cache Stats:`, { logToConsole: false });
            consoleX.dir(cachify[this.#_flavor].stats, { logToConsole: false });
            consoleX.predefined.diver('-', { logToConsole: false });
            consoleX.log('');

            consoleX.time({
                id: 'cache_clearing',
                title: 'Clearing the cache',
                tag: 'Cache Clearing'
            })
            await cachify.clear();
            consoleX.timeEnd('cache_clearing');
            consoleX.newLine();
        }
    }

    constructor(flavor: F, configs: TestConfigs) {
        this.#_flavor = flavor;
        this.#_name = configs.name as TestName;
        this.#_stages = configs.stages;
        if (typeof configs.setup === 'function') { this.#_setup = configs.setup }
    }

    /**
     * Retrieves the name of the benchmark test.
     * @returns The name of the benchmark test as a string.
     */
    get name() { return this.#_name; }

    /**
     * Retrieves the tasks to add to the queue scheduler.
     * @returns The tasks to add to the queue scheduler.
     */
    get tasks(): BaseQueueTask[] { return this.#_tasks; }

    /**
     * Retrieves the results of the benchmark tests.
     * 
     * The results are stored as a record with the test name as the key and the results as the value.
     * The results include the execution time of each stage and the total execution time of the test.
     * @returns The results of the benchmark tests as a record.
     * @example
     * const results = benchmarkTest.results();
     * console.log(results.hybrid); // { executionTime: number, stages: { [key: string]: StagePromisePayload[] } }
     */
    get results() { return this.#_results; }

    /**
     * Retrieves the analytics for the benchmark tests.
     * The analytics are stored as a record with the test name as the key and the results as the value.
     * The results include the execution time of each stage and the total execution time of the test.
     * @returns The analytics for the benchmark tests as a record.
     * @example
     * const results = benchmarkTest.analytics();
     * console.log(results.hybrid); // { executionTime: number, stages: { [key: string]: StagePromisePayload[] } }
     */
    get analytics() { return this.#_analytics }

    /**
     * Analyzes the results of the benchmark tests and stores the analytics in the #_analytics property.
     * 
     * The analytics are stored as a record with the test name as the key and the results as the value.
     * The results include the execution time of each stage and the total execution time of the test.
     */
    analyzeResults() {
        for (const [stageName_, stageRes] of Object.entries(this.#_results)) {
            const stageName = stageName_ as StageName;
            const stageAnalyticsRes: StageAnalytics = {
                store: stageRes.store,
                tasks: {}
            };

            for (const [taskName_, tasksRes] of Object.entries(stageRes.tasks)) {
                const taskName = taskName_ as TaskName;
                stageAnalyticsRes.tasks[taskName] = this.#_helpers.collectTaskStats(taskName, tasksRes)
            }

            this.#_analytics[stageName] = stageAnalyticsRes
        }
    }

    /**
     * Sets up the benchmark test.
     * This function adds the memory and redis (if enabled) tasks to the stage.
     * It then calls the setup function of the test.
     * @example
     * await benchmarkTest.setup();
     */
    async setup() {
        this.#_helpers.addTask.memory(this.#_stages);
        if (globalConfigs.flags.hasRedis) {
            this.#_helpers.addTask.redis(this.#_stages);
            this.#_helpers.addTask.hybrid(this.#_stages);
        }

        await this.#_setup();
    }
}

export default Test;