import { AdaptiveTaskQueue } from "@nasriya/atomix/tools";

const restoreQueue = new AdaptiveTaskQueue({
    autoRun: true,
    windowDurationMs: 300,
    recalcDebounce: 100
})

export default restoreQueue;