import { createClient as createRedisClient } from '@redis/client';
import cachify from '../../src/cachify';

if (process.env.REDIS_BENCHMARK_URL) {
    const redisClient = createRedisClient({ url: process.env.REDIS_BENCHMARK_URL });
    await redisClient.connect();
    await redisClient.flushDb('ASYNC');
    cachify.engines.useRedis('redis', redisClient);
}