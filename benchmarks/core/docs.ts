import type { Brand } from "@nasriya/atomix";
import type { CacheFlavor } from "../../src";

export type SupportedStores = 'memory' | 'redis';
export type StageTask = 'set' | 'cold_read' | 'hot_read' | (string & {});

export type StageStats<T extends StageTask> = {
    task: T;
    fastest: number; // ms
    slowest: number; // ms
    average: number; // ms
    succeeded: number;
    failed: number;
    total: number;
};

export type StagePromisePayload<T extends StageTask> = {
    stage: T;
    index: number;
    startTime: number;
    endTime: number;
}

export type StageReturnType = {
    store: SupportedStores[],
    tasks: Record<
        TaskName,
        PromiseSettledResult<
            StagePromisePayload<StageTask>
        >[]
    >
}

export type BenchmarkAnalytics = Record<TestName, TestAnalytics>;
export type TestAnalytics = Record<StageName, StageAnalytics>;
export type StageAnalytics = {
    store: SupportedStores[],
    tasks: Record<TaskName, StageStats<StageTask>>;
}

export type TestName = Brand<string, 'TestName'>;
export type StageName = Brand<string, 'StageName'>;
export type TaskName = Brand<string, 'TaskName'>;

export interface StageConfigs<F extends CacheFlavor> {
    flavor: F;
    recordsNumber: number;
    storeIn: SupportedStores[];
    tasksToRun: TestStageFunction<F>[];
}

export interface TestConfigs {
    name: string;
    stages: TestStageFunction<CacheFlavor>[];
    setup?: () => Promise<any>;
}

export interface StageCTX<F extends CacheFlavor> {
    tasks: StageReturnType['tasks'];
    flavor: F;
    recordsNumber: number;
    storeIn: {
        value: SupportedStores[];
        encoded: string;
    };
}

export type TestStageFunction<F extends CacheFlavor = CacheFlavor> = (ctx: StageCTX<F>) => Promise<void>;