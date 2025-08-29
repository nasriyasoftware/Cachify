import fs from 'fs/promises';
import { AdaptiveTaskQueue } from "@nasriya/atomix/tools";
import type { BaseQueueTask } from "@nasriya/atomix/tools";
import type { Stats } from "fs";

type StatParameters = Parameters<typeof fs.stat>;
type ReadFileParameters = Parameters<typeof fs.readFile>;
type ReadFileReturnType = string | Buffer;
type WriteFileParameters = Parameters<typeof fs.writeFile>;

class CacheFileSystem {
    readonly #_queue: AdaptiveTaskQueue;

    constructor() {
        this.#_queue = new AdaptiveTaskQueue({ autoRun: true });
    }

    /**
     * Asynchronously stat a file or directory.
     * @param path The path of the file or directory to stat.
     * @returns A promise that resolves to the results of the stat operation.
     */
    stat(...args: StatParameters): Promise<Stats> {
        return new Promise<Stats>((resolve, reject) => {
            const task: BaseQueueTask<Stats> = {
                type: 'stat',
                action: async () => {
                    const res = await fs.stat(...args);
                    return res as Stats;
                },
                onResolve: resolve,
                onReject: reject
            }

            this.#_queue.addTask(task);
        })
    }

    /**
     * Reads the contents of a file and returns a promise that resolves to
     * either a string or a buffer, depending on the options provided.
     * @param path The path of the file to read.
     * @param options The options to use when reading the file.
     * @returns A promise that resolves to the contents of the file.
     */
    readFile(...args: ReadFileParameters): Promise<ReadFileReturnType> {
        return new Promise<ReadFileReturnType>((resolve, reject) => {
            const task: BaseQueueTask<ReadFileReturnType> = {
                type: 'readFile',
                action: async () => {
                    const res = await fs.readFile(...args);
                    return res;
                },
                onResolve: resolve,
                onReject: reject
            }

            this.#_queue.addTask(task);
        })
    }

    /**
     * Writes data to a file, replacing the file if it already exists.
     * @param path The path of the file to write.
     * @param data The data to write to the file.
     * @param options The options to use when writing the file.
     * @returns A promise that resolves when the write operation is complete.
     */
    writeFile(...args: WriteFileParameters): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const task: BaseQueueTask<void> = {
                type: 'readFile',
                action: async () => {
                    const res = await fs.writeFile(...args);
                    return res;
                },
                onResolve: resolve,
                onReject: reject
            }

            this.#_queue.addTask(task);
        })
    }
}

const filesystem = new CacheFileSystem();
export default filesystem;