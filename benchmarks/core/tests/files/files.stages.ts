import atomix from "@nasriya/atomix";
import cachify from "../../../../src/cachify";
import consoleX from "../../../setup/console";
import configs from "../../../setup/configs";
import path from 'path'
import type { StagePromisePayload, TaskName, TestStageFunction } from "../../docs";

const setStage: TestStageFunction = async (ctx) => {
    const tag = `[${ctx.flavor.toUpperCase()}][${ctx.storeIn.value.join(' | ')}]`;
    const taskName = 'set' as TaskName;

    consoleX.time({ id: 'creaet_set_promises', title: `${tag} Creating SET promises...`, tag: 'SET Promises' });
    const setPromises: Promise<StagePromisePayload<'set'>>[] = [];

    for (let i = 0; i < ctx.recordsNumber; i++) {
        setPromises.push(new Promise((resolve, reject) => {
            const response: StagePromisePayload<'set'> = {
                stage: 'set',
                index: i,
                startTime: Date.now(),
                endTime: 0
            }

            // Use a copy of the test file
            const filePath = path.join(configs.testDir, `cachify-benchmark-${i}.txt`);
            cachify.files.set(filePath, { storeIn: ctx.storeIn.value }).then(() => {
                response.endTime = Date.now();
                resolve(response);
            }).catch((err) => {
                response.endTime = Date.now();
                // @ts-ignore
                response.error = err;
                reject(response);
            })
        }));
    }
    consoleX.timeEnd('creaet_set_promises');

    consoleX.time({ id: 'execute_set_promises', title: `${tag} Setting values...`, tag: 'SET' });
    const results: PromiseSettledResult<
        StagePromisePayload<'set'>
    >[] = [];

    const chunks = atomix.dataTypes.array.chunk(setPromises, 100);
    for (const chunk of chunks) {
        results.push(...(await Promise.allSettled(chunk)));
    }
    ctx.tasks[taskName] = results;
    consoleX.timeEnd('execute_set_promises');
}

const getReadStages = () => {
    const tests: TestStageFunction[] = [];
    for (const state of ['cold', 'hot'] as const) {
        tests.push(async (ctx) => {
            const tag = `[${ctx.flavor.toUpperCase()}][${ctx.storeIn.value.join(' | ')}]`;
            const taskName = `${state}_read`;
            consoleX.time({ id: `create_get_file_${state}_promises`, title: `${tag} Creating ${state.toUpperCase()} GET promises...`, tag: 'GET Promises' });
            const getPromises: Promise<StagePromisePayload<`${typeof state}_read`>>[] = [];

            for (let i = 0; i < ctx.recordsNumber; i++) {
                getPromises.push(new Promise((resolve, reject) => {
                    const response: StagePromisePayload<`${typeof state}_read`> = {
                        stage: `${state}_read`,
                        index: i,
                        startTime: Date.now(),
                        endTime: 0
                    };

                    const filePath = path.join(configs.testDir, `cachify-benchmark-${i}.txt`);
                    cachify.files.read({ filePath }).then(() => {
                        response.endTime = Date.now();
                        resolve(response);
                    }).catch((err) => {
                        response.endTime = Date.now();
                        // @ts-ignore
                        response.error = err;
                        reject(response);
                    });
                }));
            }
            consoleX.timeEnd(`create_get_file_${state}_promises`);

            consoleX.time({ id: `execute_get_file_${state}_promises`, title: `${tag} Reading files...`, tag: 'GET' });
            const results: PromiseSettledResult<
                StagePromisePayload<typeof taskName>
            >[] = [];

            const chunks = atomix.dataTypes.array.chunk(getPromises, 100);
            for (const chunk of chunks) {
                results.push(...(await Promise.allSettled(chunk)));
            }
            ctx.tasks[taskName as TaskName] = results;
            consoleX.timeEnd(`execute_get_file_${state}_promises`);
        })
    }

    return tests;
}

const stages: TestStageFunction[] = [setStage, ...getReadStages()];
export default stages;