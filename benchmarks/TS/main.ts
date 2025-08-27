'./setup';
import helpers, { consoleX } from './assets/helpers';
import path from 'path';
import ansiLogo from './assets/logo';
import { TasksQueue } from '@nasriya/atomix/tools';

// Import metas
import { getBenchmarkMeta as getKVMeta } from './bench/kv_bench/meta';
import { getBenchmarkMeta as getFilesMeta } from './bench/files_bench/meta';
import { BenchMeta, MainBenchmarkAnalytics, MainBenchmarkResults, } from './setup';
// import cachify from '../../src/cachify';
// cachify.debug = true;

const configs = helpers.getConfig();

const tasksQueue = new TasksQueue();
const execResults: MainBenchmarkResults = {};
const { colors, style, reset } = consoleX.formatting;


const metas: Record<string, BenchMeta> = {
    kv: getKVMeta(configs.kv_records_count),
    files: getFilesMeta(configs.file_count)
}

async function benchmark() {
    try {
        consoleX.log(ansiLogo.medium, { logToFile: false });
        consoleX.predefined.systemInfo();

        consoleX.newLine();
        consoleX.log(`🚀 ${colors.yellow}${style.bold}Cachify Benchmarks${reset} 🚀`);
        consoleX.log('');

        consoleX.time({ id: 'env_setup', title: `${colors.magenta}1. 🔧 Setting up the environment`, tag: 'Env. Setup' });
        await utils.setup();
        consoleX.timeEnd('env_setup');
        consoleX.predefined.diver('=', { colorCode: 'white' });
        consoleX.newLine();

        consoleX.time({ id: 'bench_duration', title: `${colors.magenta}2. 🚀 Starting Benchmarking`, tag: 'Benchmark' });
        consoleX.newLine();
        utils.addTasksToQueue();
        await tasksQueue.run();
        consoleX.timeEnd('bench_duration');
        consoleX.log(`${colors.green}${style.bold}🏁 Benchmark Complete.${reset}`);
        consoleX.newLine();

        consoleX.predefined.diver('=', { colorCode: 'white' });
        consoleX.time({ id: 'run_analysis', title: `${colors.magenta}3. 📈 Analyzing the results`, tag: 'Analysis' });
        const analytics = await helpers.analyzeResults(execResults);
        consoleX.timeEnd('run_analysis');
        consoleX.log('');


        consoleX.predefined.title('Benchmark Results');
        consoleX.log(`📂 ${colors.blue}Output Directories`);
        consoleX.log(`- Performance results:\n  ${consoleX.formatting.colors.yellow}${path.join(configs.out_dir, 'results.json')}${consoleX.formatting.reset}`);
        consoleX.log(`- Benchmark logs:\n  ${consoleX.formatting.colors.yellow}${path.join(configs.out_dir, 'benchmark.log')}${consoleX.formatting.reset}`);
        consoleX.newLine();

        consoleX.log(`📊 ${colors.blue}Analysis Results`);
        utils.printAnalysisTables(analytics);
        consoleX.log('');
        consoleX.predefined.title('Cachify Benchmarks: End');
    } catch (error) {
        console.error(error);
    } finally { 
        await helpers.cleanup();
    }
}

const utils = {
    addTasksToQueue: () => {
        for (const meta of Object.values(metas)) {
            execResults[meta.testName] = meta.resultsReference;
            for (const task of meta.tasks) {
                tasksQueue.addTask(task);
            }
        }
    },
    setup: async () => {
        for (const meta of Object.values(metas)) {
            await meta?.setup();
        }
    },
    printAnalysisTables: (analytics: MainBenchmarkAnalytics) => {
        for (const [benchName, benchRes] of Object.entries(analytics)) {
            // Benchamrk data
            consoleX.predefined.diver('-');
            consoleX.log(`📊 ${colors.blue}Analysis Results for ${colors.yellow}${benchName}${colors.blue}:\n`);
            consoleX.log('');

            for (const [implName, implData] of Object.entries(benchRes)) {
                // Implementation data
                const {store, tests} = implData;
                consoleX.log(`- ${colors.yellow}${implName}${reset} Implementation [${colors.yellow}${store.join(', ')}${reset}]:`);
                
                const table = {} as any;
                for (const testStats of Object.values(tests)) {
                    const { stage, ...rest } = testStats;
                    table[stage] = rest;
                }

                consoleX.log('')
                consoleX.table(table);
                consoleX.newLine();
            }
        }
    }
}

export default benchmark;