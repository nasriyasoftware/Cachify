import type { CacheFlavor } from "../../../src";
import type { StageConfigs, StageReturnType, SupportedStores, StageCTX, TestStageFunction } from "../docs";
import consoleX from "../../setup/console";

class Stage<F extends CacheFlavor> {
    readonly #_flavor: F;
    readonly #_recordsNumber: number;
    readonly #_tasksToRun: TestStageFunction<F>[] = [];
    readonly #_tasks: StageReturnType['tasks'] = {};
    readonly #_storeIn: {
        value: SupportedStores[],
        encoded: string;
    };

    readonly #_ctx: StageCTX<F>;

    constructor(configs: StageConfigs<F>) {
        this.#_flavor = configs.flavor;
        this.#_recordsNumber = configs.recordsNumber;
        this.#_tasksToRun = configs.tasksToRun || [];
        this.#_storeIn = {
            value: configs.storeIn,
            encoded: configs.storeIn.join('-')
        }

        this.#_ctx = {
            flavor: this.#_flavor,
            tasks: this.#_tasks,
            recordsNumber: this.#_recordsNumber,
            storeIn: this.#_storeIn,
        }
    }

    /**
     * Retrieves the flavor of the cache record.
     * @returns {F} The flavor of the cache record.
     */
    get flavor(): F {
        return this.#_flavor;
    }

    /**
     * Starts the benchmark. This function will execute all the stages in order and then write the results to the console.
     * @throws {Error} If any of the stages throw an error.
     */
    async run() {
        consoleX.log(`[${this.#_flavor.toUpperCase()}] Benchmarking ${this.#_recordsNumber} records in ${this.#_storeIn.value.join('-')}...`)

        try {
            consoleX.time({
                title: `[${this.#_flavor.toUpperCase()}] Finished writing ${this.#_recordsNumber} records.`,
                tag: 'BENCHMARK',
                id: 'bench_duration'
            });

            for (let task of this.#_tasksToRun) {
                await task(this.#_ctx);
            }
        } catch (error) {
            throw error;
        } finally {
            consoleX.timeEnd('bench_duration');
        }
    }

    /**
     * Retrieves the results of the benchmark.
     * @returns {StageReturnType} An object containing the results of the benchmark.
     * @property {string[]} store - The list of stores used in the benchmark.
     * @property {Record<string, StagePromisePayload[]>} tasks - A record containing the results of each task of the benchmark.
     */
    get results(): StageReturnType {
        return {
            store: this.#_storeIn.value,
            tasks: this.#_tasks
        }
    }
}

export default Stage;