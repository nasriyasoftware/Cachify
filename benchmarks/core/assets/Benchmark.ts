import overwatch from "@nasriya/overwatch";
import cron from "@nasriya/cron";
import cachify from "../../../src/cachify";
import type { CacheFlavor } from "../../../src";

import type { BenchmarkAnalytics, StageName, StageReturnType, TaskName, TestName } from "../docs";
import { TasksQueue } from "@nasriya/atomix/tools";
import Test from "./Test";
import consoleX from "../../setup/console";
import ansiLogo from '../../assets/logo';
import globalConfigs from "../../setup/configs";

import path from "path";
import fs from "fs";

const { colors, style, reset } = consoleX.formatting;

class Benchmark {
    readonly #_tests: Test<CacheFlavor>[];
    readonly #_queue = new TasksQueue({ autoRun: false });
    readonly #_executionResults: Record<TestName, Record<StageName, StageReturnType>> = {};
    readonly #_analyticsRes: BenchmarkAnalytics = {};
    readonly #_flags = { running: false };

    constructor(tests: Test<any>[]) {
        this.#_tests = tests;
    }

    readonly #_helpers = {
        setup: async () => {
            for (const test of this.#_tests) {
                await test.setup();
            }
        },
        addTestsToQueue: () => {
            for (const test of this.#_tests) {
                this.#_queue.bulkAddTasks(test.tasks);
            }
        }
    }

    readonly #_analytics = {
        helpers: {
            storeData: () => {
                for (const test of this.#_tests) {
                    this.#_executionResults[test.name] = test.results;
                }
            },
            analyzeResults: () => {
                for (const test of this.#_tests) {
                    test.analyzeResults();
                    this.#_analyticsRes[test.name] = test.analytics;
                }
            },
            writeResultsToDisk: async () => {
                if (!fs.existsSync(globalConfigs.outDir)) {
                    await fs.promises.mkdir(globalConfigs.outDir);
                }
                // Store the analytics results in a file
                const resultsFile = path.join(globalConfigs.outDir, 'results.json');
                await fs.promises.writeFile(resultsFile, JSON.stringify(this.#_analyticsRes, null, 4));
            }
        },
        analyze: async () => {
            this.#_analytics.helpers.storeData();
            this.#_analytics.helpers.analyzeResults();
            await this.#_analytics.helpers.writeResultsToDisk();
        },
        print: () => {
            for (const [testName_, testAnalytics] of Object.entries(this.#_analyticsRes)) {
                const testName = testName_ as TestName;
                // Benchamrk data
                consoleX.predefined.diver('-');
                consoleX.log(`📊 ${colors.blue}Analysis Results for ${colors.yellow}${testName}${colors.blue}:\n`);

                for (const [stageName_, stageAnalytics] of Object.entries(testAnalytics)) {
                    const stageName = stageName_ as StageName;

                    consoleX.log(`- ${colors.yellow}${stageName}${reset} Implementation [${colors.yellow}${stageAnalytics.store.join(', ')}${reset}]:`);
                    const table = {} as any;
                    for (const [taskName_, taskStats] of Object.entries(stageAnalytics.tasks)) {
                        const taskName = taskName_ as TaskName;
                        table[taskName] = taskStats;
                    }

                    consoleX.table(table);
                    consoleX.newLine();
                }
            }
        }
    }

    async run() {
        if (this.#_flags.running) {
            console.warn(`[WARN] Benchmark is already running.`);
            return;
        }

        try {
            this.#_flags.running = true;

            // Benchmark labels
            {
                consoleX.log(ansiLogo.medium, { logToFile: false });
                consoleX.predefined.systemInfo();

                consoleX.log('');
                consoleX.log(`🚀 ${colors.yellow}${style.bold}Cachify Benchmarks${reset} 🚀`);
                consoleX.log('');
            }

            // Setup environment
            {
                consoleX.time({ id: 'env_setup', title: `${colors.magenta}1. 🔧 Setting up the environment`, tag: 'Env. Setup' });
                await this.#_helpers.setup();
                consoleX.timeEnd('env_setup');
                consoleX.predefined.diver('=', { colorCode: 'white' });
                consoleX.newLine();
            }

            // Run tests
            {
                consoleX.time({ id: 'bench_duration', title: `${colors.magenta}2. 🚀 Starting Benchmarking`, tag: 'Benchmark' });
                consoleX.log('');
                this.#_helpers.addTestsToQueue();
                await this.#_queue.run();
                consoleX.timeEnd('bench_duration');
                consoleX.log(`${colors.green}${style.bold}🏁 Benchmark Complete.${reset}`);
                consoleX.log('');
            }

            // Analyze results
            {
                consoleX.predefined.diver('=', { colorCode: 'white' });
                consoleX.time({ id: 'run_analysis', title: `${colors.magenta}3. 📈 Analyzing the results`, tag: 'Analysis' });
                await this.#_analytics.analyze();
                consoleX.timeEnd('run_analysis');
                consoleX.newLine();
            }

            // Print results
            {
                consoleX.predefined.title('Benchmark Results');
                consoleX.log(`📂 ${colors.blue}Output Directories`);
                consoleX.log(`- Performance results:\n  ${consoleX.formatting.colors.yellow}${path.join(globalConfigs.outDir, 'results.json')}${consoleX.formatting.reset}`);
                consoleX.log(`- Benchmark logs:\n  ${consoleX.formatting.colors.yellow}${path.join(globalConfigs.outDir, 'benchmark.log')}${consoleX.formatting.reset}`);
                consoleX.newLine();

                consoleX.log(`📊 ${colors.blue}Analysis Results`);
                this.#_analytics.print();
            }

            consoleX.predefined.title('Cachify Benchmarks: End');
        } catch (error) {
            console.error(error);
        } finally {
            await Promise.all([
                cachify.clear(),
                cron.destroy(),
                consoleX.flush(),
                fs.promises.rm(globalConfigs.testDir, { recursive: true, force: true })
            ])
            overwatch.control.pause();
            process.exit(0);
        }
    }
}

export default Benchmark;