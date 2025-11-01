import atomix from '@nasriya/atomix';
import cachify from '../../src/cachify';
import { loadEnv } from '../../scripts/loadEnv';
import { createClient as createRedisClient } from '@redis/client';

import path from 'path';
import fs from 'fs';
import os from 'os';

cachify.kvs.configs.eviction.maxRecords = Infinity;

class BenchmarkGlobalConfigs {
    readonly #_data = {
        outDir: path.join(process.cwd(), 'cachify', 'benchmarks-results'),
        testDir: path.join(os.tmpdir(), 'nasriya', 'cachify'),
        flags: Object.seal({
            initialized: false,
            hasRedis: false
        }),

        consts: Object.freeze({
            lineHeight: 50
        }),

        counts: Object.seal({
            /** The number of KV items to use in the benchmark. */
            files: 1_000,
            /** The number of file items to use in the benchmark. */
            kvs: 10_000
        }),

    }

    /**
     * The directory to write the benchmark results to.
     * You must have write access to this directory.
     */
    get outDir() { return this.#_data.outDir; }

    /**
     * The temporary directory to write the benchmark test files to.
     * This directory will be cleaned up after the benchmark is finished.
     */
    get testDir() { return this.#_data.testDir; }

    /**
     * Returns a shallow copy of the flags object.
     * @returns A shallow copy of the flags object.
     * @example
     * const flags = configs.flags;
     * console.log(flags.initialized); // false
     */
    get flags() {
        return { ...this.#_data.flags };
    }

    get consts() { return this.#_data.consts; }
    get counts() { return this.#_data.counts; }

    get systemInfo() {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();

        return atomix.dataTypes.object.deepFreeze({
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
        })
    }

    /**
     * Updates the benchmark configurations from the environment variables.
     *
     * The following environment variables are supported:
     * - `BENCHMARK_KV_COUNT`: The number of KV items to use in the benchmark.
     * - `BENCHMARK_FILES_COUNT`: The number of file items to use in the benchmark.
     * - `BENCHMARK_OUT_DIR`: The directory to write the benchmark results to.
     * - `REDIS_BENCHMARK_URL`: The URL of the Redis server to use for the benchmark.
     *
     * If any of the environment variables are invalid, the process will exit with a status code of 1.
     * @returns A promise that resolves when the benchmark configurations have been updated.
     */
    async update(options?: { force: boolean }) {
        const forced = typeof options?.force === 'boolean' ? options.force : false;
        if (this.#_data.flags.initialized && !forced) { return };

        try {
            const envPath = path.join(process.cwd(), 'benchmarks', 'benchmarks.env');
            await loadEnv(envPath);

            if (process.env.BENCHMARK_KV_COUNT) {
                const parsed = parseInt(process.env.BENCHMARK_KV_COUNT);
                if (Number.isNaN(parsed)) { throw new Error(`BENCHMARK_KV_COUNT is not a number: ${process.env.BENCHMARK_KV_COUNT}`); }
                if (parsed < 0) { throw new Error(`BENCHMARK_KV_COUNT is negative: ${process.env.BENCHMARK_KV_COUNT}`); }
                if (parsed >= 5_000_000) { console.warn(`[WARN] BENCHMARK_KV_COUNT is high: ${process.env.BENCHMARK_KV_COUNT}`); }
                this.counts.kvs = parsed;
            }

            if (process.env.BENCHMARK_FILES_COUNT) {
                const parsed = parseInt(process.env.BENCHMARK_FILES_COUNT);
                if (Number.isNaN(parsed)) { throw new Error(`BENCHMARK_FILES_COUNT is not a number: ${process.env.BENCHMARK_FILES_COUNT}`); }
                if (parsed < 0) { throw new Error(`BENCHMARK_FILES_COUNT is negative: ${process.env.BENCHMARK_FILES_COUNT}`); }
                if (parsed >= 5_000) { console.warn(`[WARN] BENCHMARK_FILES_COUNT is high: ${process.env.BENCHMARK_FILES_COUNT}`); }
                this.counts.files = parsed;
            }

            if (process.env.BENCHMARK_OUT_DIR) {
                const out_dir = process.env.BENCHMARK_OUT_DIR;
                if (!fs.existsSync(out_dir)) { throw new Error(`BENCHMARK_OUT_DIR does not exist: ${out_dir}`); }

                const permissions = {
                    read: atomix.fs.canAccessSync(out_dir, { permissions: 'Read' }),
                    write: atomix.fs.canAccessSync(out_dir, { permissions: 'Write' })
                }

                if (!permissions.read) { throw new Error(`The current user does not have read access to the BENCHMARK_OUT_DIR: ${out_dir}`); }
                if (!permissions.write) { throw new Error(`The current user does not have write access to the BENCHMARK_OUT_DIR: ${out_dir}`); }

                this.#_data.outDir = out_dir;
            }

            if (process.env.REDIS_BENCHMARK_URL) {
                const redisClient = createRedisClient({ url: process.env.REDIS_BENCHMARK_URL });
                await redisClient.connect();
                await redisClient.flushDb('ASYNC');
                cachify.engines.useRedis('redis', redisClient);
                this.#_data.flags.hasRedis = true;
            }
        } catch (error) {
            console.error(error);
            process.exit(1);
        } finally {
            if (!this.#_data.flags.initialized) { this.#_data.flags.initialized = true; }
        }
    }

    /**
     * Returns a JSON-serializable object containing the current configuration.
     * @returns A JSON-serializable object containing the current configuration.
     * @example
     * const configs = new Configs();
     * const json = configs.toJSON();
     * @example
     * const json = {
     *   "consts": {
     *     "height": 50,
     *     "redis": false,
     *     "testDir": "path/to/test/dir"
     *   },
     *   "counts": {
     *     "files": 1_000,
     *     "kvs": 100_000
     *   },
     *   "outDir": "path/to/out/dir",
     *   "testDir": "path/to/test/dir"
     * }
     */
    toJSON() {
        return atomix.dataTypes.object.deepFreeze({
            consts: this.consts,
            counts: this.counts,
            outDir: this.outDir,
            testDir: this.testDir,
            flags: this.flags,
            systemInfo: this.systemInfo
        });
    }
}

const globalConfigs = new BenchmarkGlobalConfigs();
export default globalConfigs;