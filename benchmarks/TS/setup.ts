import './assets/redis';
import path from 'path';
import os from 'os';
import { Brand } from '@nasriya/atomix';

/** The - temp - test directory for the benchmark */
export const TEST_DIR = path.join(os.tmpdir(), 'nasriya', 'cachify');
export const FILE_CONTENT = 'A'.repeat(1024 * 64); // 64 KB
export const LINE_LENGTH = 50;

export type BenchmarkStage = 'set' | 'cold_read' | 'hot_read' | (string & {});

export type BenchmarkStats<T extends BenchmarkStage = string> = {
    stage: T;
    fastest: number; // ms
    slowest: number; // ms
    average: number; // ms
    succeeded: number;
    failed: number;
    total: number;
};

export type StagePromisePayload<T extends BenchmarkStage> = {
    stage: T;
    index: number;
    startTime: number;
    endTime: number;
}

export type TestReturnType = {
    store: ('memory' | 'redis')[],
    tests: { [key: StageName]: PromiseSettledResult<StagePromisePayload<BenchmarkStage>>[] }
}

export type TestReturnAnalytics = {
    store: ('memory' | 'redis')[],
    tests: { [key: StageName]: BenchmarkStats }
}

export interface BenchMeta {
    testName: BenchmarkName;
    resultsReference: MainBenchmarkResults[BenchmarkName];
    tasks: {
        type: StageName;
        action: () => Promise<any>;
        onResolve: (res: any) => void;
        onReject: (error: any) => void;
        onDone: () => void;
    }[],
    setup: () => Promise<any>;
}

export type MainBenchmarkResults = Record<BenchmarkName, Record<StageName, TestReturnType>>;
export type MainBenchmarkAnalytics = Record<BenchmarkName, Record<StageName, TestReturnAnalytics>>;
export type BenchmarkName = Brand<string, 'BenchmarkName'>;
export type StageName = Brand<string, 'TestName'>;
