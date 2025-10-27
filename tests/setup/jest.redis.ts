import { createClient } from "@redis/client";
import cachify from "../../src";

const redisUrl = process.env.REDIS_TEST_URL;
if (!redisUrl) {
    throw new Error("REDIS_TEST_URL is not defined in the environment.");
}

const redisClient = createClient({ url: redisUrl });

beforeAll(async () => {
    await redisClient.connect();
    await redisClient.flushDb('ASYNC');
});

afterAll(async () => {
    await redisClient.quit();
});

cachify.engines.useRedis('redis', redisClient);
export default redisClient;