import { BaseCacheTask, TaskPriorityLevel } from "./docs";
import uuidX from "@nasriya/uuidx";
import atomix from "@nasriya/atomix";

class GlobalTaskQueue {
    readonly #_flags = Object.seal({ isRunning: false })
    readonly #_queues: Map<TaskPriorityLevel, BaseCacheTask[]> = new Map([
        [0, []], [1, []], [2, []], [3, []],
    ]);

    /**
     * Retrieves the next task from the queues, with the highest priority queue
     * being searched first. If all queues are empty, returns undefined.
     * @returns the next task, or undefined if all queues are empty
     */
    #_getNextTask(): BaseCacheTask | undefined {
        const priorityLevels: TaskPriorityLevel[] = [0, 1, 2, 3];
        for (const level of priorityLevels) {
            const queue = this.#_queues.get(level)!;
            if (queue.length > 0) {
                return queue.shift();
            }
        }
        return undefined;
    }

    /**
     * Returns true if there are any tasks in any of the queues, and false
     * otherwise.
     * @returns true if there are any tasks in any of the queues, and false
     * otherwise
     */
    #_hasNext(): boolean {
        for (const [_, queue] of this.#_queues) {
            if (queue.length > 0) { return true }
        }

        return false;
    }

    async #_run() {
        if (this.#_flags.isRunning) { return }
        this.#_flags.isRunning = true;

        try {
            while (this.#_hasNext()) {
                const task = this.#_getNextTask()!;

                try {
                    const result = await task.action();
                    this.#_handlers.onResolve(task, result);
                } catch (err) {
                    this.#_handlers.onReject(task, err);
                } finally {
                    this.#_handlers.onDone(task);
                }
            }
        } finally {
            this.#_flags.isRunning = false;
        }
    }

    readonly #_stats = {
        total: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        get pending() {
            return this.total - this.processed;
        }
    }

    readonly #_handlers = {
        onResolve: (task: BaseCacheTask, userData: any) => {
            this.#_stats.succeeded++;

            // Run user onResolve callback
            try {
                task?.onResolve?.(userData);
            } catch (callbackError) {
                this.#_helpers.logger.taskCallbackError('onResolve', task.id, callbackError);
            }
        },
        onReject: (task: BaseCacheTask, error: any) => {
            this.#_stats.failed++;

            // Run user onReject callback
            try {
                task?.onReject?.(error);
            } catch (callbackError) {
                this.#_helpers.logger.taskCallbackError('onReject', task.id, callbackError);
            }
        },
        onDone: (task: BaseCacheTask) => {
            this.#_helpers.id.remove(task.id);
            this.#_stats.processed++;

            // Run user onDone callback
            try {
                task?.onDone?.();
            } catch (callbackError) {
                this.#_helpers.logger.taskCallbackError('onDone', task.id, callbackError);
            }

            // Check if there are any more tasks to process
            if (this.#_stats.pending === 0) {
                this.#_handlers.onComplete();
            }
        },
        onComplete: () => {
            this.#_flags.isRunning = false;
            for (const callback of this.#_userHandlers.onIdle) {
                try {
                    callback();
                } catch (error) {
                    this.#_helpers.logger.taskCallbackError('onIdle', 'unknown', error);
                }
            }

            this.#_userHandlers.onIdle = [];
        }
    }

    readonly #_userHandlers = {
        onIdle: [] as (() => void)[],
    }

    readonly #_helpers = {
        id: {
            list: [] as string[],
            /**
             * Generates a unique identifier using the uuidX library. It ensures that 
             * the generated ID is not already present in the list of existing IDs 
             * before adding it to the list and returning it.
             * 
             * @returns {string} A unique identifier.
             */
            generate: (): string => {
                let attempts = 0
                let id = uuidX.v4();
                while (this.#_helpers.id.list.includes(id)) {
                    if (++attempts > 1000) throw new Error('Failed to generate a unique task ID');
                    id = uuidX.v4();
                }
                this.#_helpers.id.list.push(id);
                return id;
            },
            remove: (id: string) => {
                const index = this.#_helpers.id.list.indexOf(id);
                if (index !== -1) {
                    this.#_helpers.id.list.splice(index, 1);
                }
            }
        },
        logger: {
            taskCallbackError: (hook: 'onResolve' | 'onReject' | 'onDone' | 'onIdle', taskId: string, error: unknown) => {
                const err = error instanceof Error ? error : new Error(String(error));
                console.warn(`[GlobalTaskQueue] Task ${taskId} ${hook} handler threw an error: ${err.message}`);
                console.debug(err.stack);
            }
        },
        validateTask: (task: BaseCacheTask) => {
            if (!atomix.valueIs.record(task)) { throw new TypeError(`Task is expected to be a record, but got ${typeof task}`) }
            const hasOwnProperty = atomix.dataTypes.record.hasOwnProperty.bind(atomix.dataTypes.record);
            let id: string;

            if (hasOwnProperty(task, 'id')) {
                if (!atomix.valueIs.string(task.id)) { throw new TypeError(`Task.id is expected to be a string, but got ${typeof task.id}`) }
                if (task.id.length === 0) { throw new RangeError('Task.id is expected to be a non-empty string') }
                if (this.#_helpers.id.list.includes(task.id)) { throw new RangeError(`Task.id "${task.id}" is already in use`) }
                id = task.id;
            } else {
                id = this.generateTaskId();
            }

            if (hasOwnProperty(task, 'type')) {
                if (!atomix.valueIs.string(task.type)) { throw new TypeError(`Task.type is expected to be a string, but got ${typeof task.type}`) }
                if (task.type.length === 0) { throw new RangeError('Task.type is expected to be a non-empty string') }
            } else {
                throw new SyntaxError('Task.type is required and is missing');
            }

            if (hasOwnProperty(task, 'priority')) {
                if (!atomix.valueIs.number(task.priority)) { throw new TypeError(`Task.priority is expected to be a number, but got ${typeof task.priority}`) }
                if (task.priority < 0 || task.priority > 3) { throw new RangeError(`Task.priority is expected to be between 0 and 3, but got ${task.priority}`) }
            } else {
                task.priority = 3;
            }

            if (hasOwnProperty(task, 'action')) {
                if (typeof task.action !== 'function') { throw new TypeError(`Task.action is expected to be a function, but got ${typeof task.action}`) }
            } else {
                throw new SyntaxError('Task.action is required and is missing');
            }

            if (hasOwnProperty(task, 'onResolve')) {
                if (typeof task.onResolve !== 'function') { throw new TypeError(`Task.onResolve is expected to be a function, but got ${typeof task.onResolve}`) }
            }

            if (hasOwnProperty(task, 'onReject')) {
                if (typeof task.onReject !== 'function') { throw new TypeError(`Task.onReject is expected to be a function, but got ${typeof task.onReject}`) }
            }

            if (hasOwnProperty(task, 'onDone')) {
                if (typeof task.onDone !== 'function') { throw new TypeError(`Task.onDone is expected to be a function, but got ${typeof task.onDone}`) }
            }

            if (!this.#_helpers.id.list.includes(id)) {
                this.#_helpers.id.list.push(id);
            }
        }
    }

    /**
     * Generates and returns a unique task identifier.
     * Utilizes an internal helper to ensure that the ID is not already in use.
     * 
     * @returns A unique task identifier.
     * @since v1.0.0
     */
    generateTaskId(): string {
        return this.#_helpers.id.generate();
    }

    /**
     * Adds a task to the global task queue. Tasks are added to one of four queues, based on their priority.
     * The task is validated before being added to the queue, so ensure that the task object is properly
     * configured before calling this method.
     * 
     * @param task - The task to be added to the queue.
     * @since v1.0.0
     */
    addTask(task: BaseCacheTask) {
        this.#_helpers.validateTask(task);
        this.#_queues.get(task.priority ?? 3)!.push(task);
        this.#_stats.total++;
        this.#_run();
    }

    /**
     * Adds multiple tasks to the global task queue. Tasks are added to one of four queues, based on their priority.
     * The tasks are validated before being added to the queue, so ensure that each task object is properly
     * configured before calling this method.
     * 
     * @param tasks - An array of tasks to be added to the queue.
     * @since v1.0.0
     */
    bulkAddTasks(tasks: BaseCacheTask[]) {
        tasks.forEach(task => this.#_helpers.validateTask(task));
        tasks.forEach(task => this.#_queues.get(task.priority ?? 3)!.push(task));
        this.#_stats.total += tasks.length;
        this.#_run();
    }

    /**
     * Waits for all tasks in the global task queue to finish processing. Returns a promise that is resolved
     * once all tasks have been processed and the queue is idle. This method is useful for unit testing and
     * other cases where you need to wait for all tasks to finish before proceeding.
     * 
     * @returns A promise that resolves once the queue is idle.
     * @since v1.0.0
     */
    waitForIdle(): Promise<void> {
        return new Promise(resolve => {
            if (this.#_stats.pending === 0) { return resolve(); }
            this.#_userHandlers.onIdle.push(resolve);
        });
    }
}

const globalTaskQueue = new GlobalTaskQueue();
export default globalTaskQueue;