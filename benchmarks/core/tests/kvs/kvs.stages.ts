import atomix from "@nasriya/atomix";
import cachify from "../../../../src/cachify";
import consoleX from "../../../setup/console";
import type { StagePromisePayload, TaskName, TestStageFunction } from "../../docs";

const setStage: TestStageFunction = async (ctx) => {
    const tag = `[${ctx.flavor.toUpperCase()}][${ctx.storeIn.value.join(' | ')}]`;
    const taskName = 'set' as TaskName;

    consoleX.time({ id: 'create_set_promises', title: `${tag} Creating SET promises...`, tag: 'SET Promises' });
    const setPromises: Promise<StagePromisePayload<'set'>>[] = [];

    for (let i = 0; i < ctx.recordsNumber; i++) {
        setPromises.push(
            new Promise<StagePromisePayload<'set'>>((resolve, reject) => {
                const response = {
                    stage: 'set' as const,
                    index: i,
                    startTime: Date.now(),
                    endTime: 0,
                }

                cachify.kvs.set(`key-${ctx.storeIn.encoded}-${i}`, `value-${ctx.storeIn.encoded}-${i}`, { storeIn: ctx.storeIn.value }).then(() => {
                    response.endTime = Date.now();
                    resolve(response);
                }).catch((err) => {
                    response.endTime = Date.now();
                    // @ts-ignore
                    response.error = err;
                    reject(response);
                })
            })
        )
    }
    consoleX.timeEnd('create_set_promises');

    consoleX.time({ id: 'execute_set_promises', title: `${tag} Setting values...`, tag: 'SET' });
    const results: PromiseSettledResult<
        StagePromisePayload<'set'>
    >[] = [];

    const chunks = atomix.dataTypes.array.chunk(setPromises, 500);
    for (const chunk of chunks) {
        results.push(...(await Promise.allSettled(chunk)));
    }
    ctx.tasks[taskName] = results;
    consoleX.timeEnd('execute_set_promises');
}

const readStage: TestStageFunction = async (ctx) => {
    const tag = `[${ctx.flavor.toUpperCase()}][${ctx.storeIn.value.join(' | ')}]`;
    const taskName = 'hot_read' as TaskName;

    consoleX.time({ id: 'create_get_promises', title: `${tag} Creating GET promises...`, tag: 'GET Promises' });
    const getPromises: Promise<StagePromisePayload<'hot_read'>>[] = [];

    for (let i = 0; i < ctx.recordsNumber; i++) {
        getPromises.push(
            new Promise<StagePromisePayload<'hot_read'>>((resolve, reject) => {
                const response = {
                    stage: 'hot_read' as const,
                    index: i,
                    startTime: Date.now(),
                    endTime: 0,
                }

                cachify.kvs.read(`key-${ctx.storeIn.encoded}-${i}`).then(() => {
                    response.endTime = Date.now();
                    resolve(response);
                }).catch((err) => {
                    response.endTime = Date.now();
                    // @ts-ignore
                    response.error = err;
                    reject(response);
                })
            })
        )
    }
    consoleX.timeEnd('create_get_promises');

    consoleX.time({ id: 'execute_get_promises', title: `${tag} Reading values...`, tag: 'SET' });
    const results: PromiseSettledResult<
        StagePromisePayload<'hot_read'>
    >[] = [];

    const chunks = atomix.dataTypes.array.chunk(getPromises, 500);
    for (const chunk of chunks) {
        results.push(...(await Promise.allSettled(chunk)));
    }
    ctx.tasks[taskName] = results;
    consoleX.timeEnd('execute_get_promises');
}

const tasks: TestStageFunction[] = [setStage, readStage];
export default tasks;