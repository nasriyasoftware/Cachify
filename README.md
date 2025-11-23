<img src="./.github/assets/Cachify_Full_Logo.svg" height="80px" alt="Cachify Logo" center>

# Cachify
Cachify is a fast, flexible caching library for Node.js supporting key-value and file caching with multi-storage and lifecycle management.

[![NPM License](https://img.shields.io/npm/l/%40nasriya%2Fcachify?color=lightgreen)](https://github.com/nasriyasoftware/Cachify?tab=License-1-ov-file) ![NPM Version](https://img.shields.io/npm/v/%40nasriya%2Fcachify) ![NPM Unpacked Size](https://img.shields.io/npm/unpacked-size/%40nasriya%2Fcachify) ![Last Commit](https://img.shields.io/github/last-commit/nasriyasoftware/Cachify.svg) [![Status](https://img.shields.io/badge/Status-Stable-lightgreen.svg)](link-to-your-status-page)

##### Visit us at [www.nasriya.net](https://nasriya.net).

Made with ❤️ in **Palestine** 🇵🇸

___
## Overview

Cachify is a fast, flexible caching library for Node.js that supports both key-value and file caching across multiple storage backends, with built-in lifecycle management and persistence.  
This documentation covers the essential concepts, setup, and best practices to get started quickly and efficiently.

### Contents
- [Why Cachify and When to Use It](#why-cachify-and-when-to-use-it)
  - [Key Advantages](#key-advantages)
  - [When to Use Cachify Instead of Just Redis](#when-to-use-cachify-instead-of-just-redis)
- [Installation \& Importing](#installation--importing)
  - [Installation](#installation)
- [Importing](#importing)
- [Usage](#usage)
  - [1. Creating Clients (Isolation)](#1-creating-clients-isolation)
  - [2. Registering Storage Engines](#2-registering-storage-engines)
  - [3. Default Storage Engines](#3-default-storage-engines)
  - [4. Caching (KVS \& Files)](#4-caching-kvs--files)
  - [5. Persistence \& Cold Start Recovery](#5-persistence--cold-start-recovery)
- [Testing](#testing)
  - [Required Environment Variables](#required-environment-variables)
  - [Running Tests](#running-tests)
- [Benchmarking](#benchmarking)
  - [Environment Setup](#environment-setup)
  - [Optional Environment Variables](#optional-environment-variables)
  - [Running Benchmarks](#running-benchmarks)
- [License](#license)


> [!IMPORTANT]
> 
> 🌟 **Support Our Open-Source Development!** 🌟
> We need your support to keep our projects going! If you find our work valuable, please consider contributing. Your support helps us continue to develop and maintain these tools.
> 
> **[Click here to support us!](https://fund.nasriya.net/)**
> 
> Every contribution, big or small, makes a difference. Thank you for your generosity and support!

___

## Why Cachify and When to Use It

Cachify goes **beyond traditional key-value caching** like Redis, offering a unified, flexible, and highly extensible caching solution for Node.js.

### Key Advantages

- **Unified caching for keys and files**: Cache key-value pairs and files in memory, Redis, or other backends seamlessly.  
- **Multi-storage support**: Combine memory, Redis, and custom engines for redundancy, failover, and multi-region setups.  
- **Automated file lifecycle management**: Automatic revalidation, eviction, and TTL handling.  
- **Persistence & cold-start recovery**: Backup and restore your cache to survive application restarts without rebuilding.  
- **Extensibility**: Easily plug in custom storage engines or adapters.  
- **Fastest read-first strategy**: Queries multiple backends and returns the first successful result to optimize latency.  
- **Isolation**: Multiple cache clients can coexist safely, even when sharing storage engines like Redis.

### When to Use Cachify Instead of Just Redis

- You need **file caching in memory or Redis**, with **automatic retrieval by file path**.  
- You want **automatic file revalidation** without writing extra watchers.  
- Your application requires **multi-storage redundancy** or **fastest-response reads** across multiple backends.  
- You need **persistent caching** that survives cold starts without rebuilding.  
- You want a **Node.js-native, highly extensible caching library** that complements or goes beyond Redis.


___
## Installation & Importing
### Installation

```bash
npm install @nasriya/cachify
```

## Importing
Importing in **ESM** modules
```js
import cachify from '@nasriya/cachify';
```

Importing in **CommonJS** modules
```js
const cachify = require('@nasriya/cachify').default;
```
___

## Usage
This section guides you through Cachify’s core usage in a logical order.

### 1. Creating Clients (Isolation)

The imported `cachify` object is an instance of the **`Cachify`** class,  
which **extends `CachifyClient`**. It behaves like a cache client but also provides global utilities such as debugging, configuration, and client creation.

You can create **isolated clients** for independent caches — useful for multi-tenant systems, different environments, or testing.


```js
import cachify from '@nasriya/cachify';

// Create an isolated instance
const isolated = cachify.createClient();

// Each instance maintains its own managers, engines, and configurations
await isolated.kvs.set('1', 'value');
await cachify.kvs.read('1'); // ❌ undefined — isolated from the other instance

// Both share the same API surface, but only `cachify` includes utilities like:
console.log(cachify.debug);         // Access global debug utilities
console.log(cachify.createClient);  // Create new isolated clients
```

**Notes:**
- Isolated clients behave like `CachifyClient` instances but also include additional properties and methods from `Cachify`, such as `debug` and `createClient`.
- All usage patterns shown for the global `cachify` instance apply to isolated clients.
- Useful for multi-tenant systems, testing, or environments requiring independent caches.

### 2. Registering Storage Engines
Before storing or reading records in a backend like Redis, you must register your storage engines:

```js
import { createClient } from '@redis/client';

// Create Redis clients
const redisEU = createClient({ url: process.env.REDIS_EU });
const redisUS = createClient({ url: process.env.REDIS_US });

// Register the clients with Cachify
cachify.engines.useRedis('redis-eu', redisEU);
cachify.engines.useRedis('redis-us', redisUS);

// Register a custom engine
cachify.engines.defineEngine('custom-engine', {
    onSet: async (record, value, context) => {
        context.set(record.key, value);
    },
    onRead: async (record, context): Promise<any> => {
        return context.get(record.key);
    },
    onRemove: async (record, context): Promise<void> => {
        if (context.has(record.key)) { context.delete(record.key) }
    }
});
```

**Notes:**
- Any backend (e.g., Redis) must be registered with Cachify before use.
- Names used in `storeIn` or `defaultEngines` must exactly match registered engine names.
- Attempting to use an unregistered engine will throw an error at runtime.
- Redis integration is optional; Cachify defaults to in-memory storage if no backend is configured.

### 3. Default Storage Engines
You can set default engines for any record manager (kvs, files, etc.) to avoid specifying storeIn on every operation:

```js
// For key-value records
cachify.kvs.defaultEngines = 'redis-eu';

// Or multiple engines
cachify.kvs.defaultEngines = ['redis-eu'];

// Redundant / multi-region setup
cachify.kvs.defaultEngines = ['redis-eu', 'redis-us'];

// For file records
cachify.files.defaultEngines = 'redis-eu';
cachify.files.defaultEngines = ['redis-eu', 'redis-us'];
```

**Notes:**
- Operations without a `storeIn` option automatically use the defined `defaultEngines`.
- Applies to all record managers (`kvs`, `files`, and custom managers).
- Multiple engines allow redundancy, failover, or multi-region caching.
- Engines must be registered before assigning them as defaults.
- Simplifies code and ensures consistent storage behavior across operations.

### 4. Caching (KVS & Files)
Key-Value Caching (KVS)

```js
// Recommended: set a record in the "users" scope
await cachify.kvs.set('1', { name: 'Ahmad' }, { scope: 'users' });

// Retrieve from the same scope
const user = await cachify.kvs.read('1', 'users');
console.log(user); // { name: 'Ahmad' }

// Optional: store in multiple backends
await cachify.kvs.set('2', { name: 'Omar' }, { scope: 'users', storeIn: ['memory', 'redis-eu'] });
const user2 = await cachify.kvs.read('2', 'users');
console.log(user2); // { name: 'Omar' }

// Scopes are optional — default is "global"
await cachify.kvs.set('site', { name: 'Cachify' });
const site = await cachify.kvs.read('site');
console.log(site); // { name: 'Cachify' }
```

File Caching

```js
const filePath = 'path/to/file.txt';

// Cache a file in the "documents" scope
await cachify.files.set(filePath, { scope: 'documents' });

// Inspect file metadata
const fileRecord = cachify.files.inspect({ filePath, scope: 'documents' });
console.log(fileRecord);

// Read file content (status: "miss" if loaded from disk, "hit" if cached)
const readResult = await cachify.files.read({ filePath, scope: 'documents' });
console.log(readResult);

// Scopes are optional — caches in default "global" scope
await cachify.files.set(filePath);
```

**Notes:**
- **Scopes are optional**; if omitted, the `"global"` scope is used.
- Scopes allow logical separation of data without polluting record keys (e.g., `"users"`,`"orders"`, `"documents"`).
- `kvs` is the plural API for key-value operations.
- File caching separates **metadata** from **content**, which is loaded on read.
- `storeIn` allows targeting multiple backends for redundancy, failover, or multi-region caching.
  
### 5. Persistence & Cold Start Recovery
Cachify supports persistent caching via adapters (e.g., local, S3) to backup and restore caches:
```js
import path from 'path';

const backupName = 'cars';
const testFilePath = path.join(process.cwd(), 'test', 'sample.txt');

// Register persistence adapters
cachify.persistence.use('local', { path: process.cwd() });

// Set some records
await cachify.kvs.set('a', 1);
await cachify.files.set(testFilePath);

// Backup cache
await cachify.persistence.backup('local', backupName);

// Clear memory
await cachify.clear();

// Restore cache
await cachify.persistence.restore('local', backupName);

// Access restored data
console.log(await cachify.kvs.read('a')); // 1
const fileResponse = await cachify.files.read({ filePath: testFilePath });
console.log(fileResponse); // { status: 'hit' | 'miss', content: Buffer }
```

**Notes:**
- Backup saves all key-value and file caches to the configured persistence adapter.
- Restore reloads all cached data, enabling fast recovery after cold starts.
- Works with multiple cache flavors and storage backends.
- Cloud adapters (e.g., S3) can be registered similarly to local adapters for persistent storage.

### 6. Lock Sessions & Safe Concurrency
Cachify supports **lock sessions** to safely acquire and modify records in concurrent environments. A session ensures that only the session which acquired a record can **update** or **remove** it. By default, **read operations are blocked** for records acquired by another session, but they can bypass this behavior if the session is created with the `blockRead: false` policy. Reads by the owning session are always allowed and non-blocking.


```ts
import cachify from 'cachify';

const alice = { key: "alice", scope: "users", status: "online" };
const bob = { key: "bob", scope: "users", status: "offline" };

// Seed cache
await cachify.kvs.set(alice.key, alice, { scope: "users" });
await cachify.kvs.set(bob.key, bob, { scope: "users" });

// Create sessions
const session1 = cachify.kvs.createLockSession();
const session2 = cachify.kvs.createLockSession({ timeout: 2000 });

async function updateAliceStatus() {
    // Acquire Alice record
    await session1.acquire([alice]);

    // Modify Alice safely
    alice.status = "away";
    await session1.records.update(alice.key, alice, "users");

    // Release the session, allowing others to acquire
    session1.release();
}

async function waitAndUpdateAlice() {
    // Session2 will wait to acquire Alice until session1 releases
    await session2.acquire([alice]);

    const aliceRecord = await session2.records.read<typeof alice>(alice.key, "users");
    console.log(aliceRecord?.status); // "away"

    aliceRecord!.status = "busy";
    await session2.records.update(alice.key, aliceRecord!, "users");
    session2.release();
}

await Promise.all([updateAliceStatus(), waitAndUpdateAlice()]);

// Read directly from cache
const finalAlice = await cachify.kvs.read<typeof alice>(alice.key, "users");
console.log(finalAlice?.status); // "busy"
```

**Notes:**

- `acquire(records)` ensures **exclusive access** for writes; only the session that acquires a record can perform `update` or `remove` operations.
- By default, **read operations are blocked** for records acquired by another session. Reads can only bypass this behavior if the session is created with `policy.blockRead: false`.
- Multiple sessions attempting to acquire the same record are queued and served in the order they attempt to acquire it.
- Sessions automatically enforce timeouts to prevent records from being locked indefinitely. When the timeout elapses, the session is rejected. If no timeout is configured, a default of 10 seconds is applied.

- **Release** a session to free its records for other sessions.
- Example scenario:
  - Record `A` is acquired by `S1`.
    - `S1` can `read`, `update`, and `remove` `A` without blocking.
    - Another session `S2` attempting to `read` `A` will **wait until `S1` releases it** (unless `blockRead: false`).
    - `S2` attempting to `update` or `remove` `A` will **throw an error**.
    - Performing `update` or `remove` via the cache manager is **blocked** until `S1` releases the record.


___
## Testing
To run Cachify tests locally, you need to create an environment file at `tests/setup/test.env`


### Required Environment Variables

- **Redis Testing**
  - `REDIS_TEST_URL` — The URL of a Redis server for running tests.
  - ⚠️ The Redis server will be flushed before tests start, so **do not use a production Redis instance**.

- **Amazon S3 Persistence Testing (Optional)**
  - `S3_TEST_BUCKET` — The bucket name to use for tests.
  - `S3_TEST_REGION` — The AWS region of the bucket.
  - `S3_TEST_KEY` — AWS access key ID.
  - `S3_TEST_SECRET` — AWS secret access key.

### Running Tests

After creating and populating the env file, simply run:

```bash
npm test
```

___

## Benchmarking

Cachify provides a built-in benchmarking suite to measure the performance of key-value and file caching across different storage engines.

### Environment Setup

You can optionally create an environment file at `benchmarks/benchmarks.env`. This file allows you to customize benchmark parameters. If it’s missing, Cachify will automatically fall back to safe defaults.

### Optional Environment Variables

- `BENCHMARK_KV_COUNT` — Number of key-value records to benchmark. Default: `100000`
- `BENCHMARK_FILES_COUNT` — Number of file records to benchmark. Default: `1000`
- `BENCHMARK_OUT_DIR` — Directory to store benchmark results. Default: `${process.cwd()}/cachify/benchmarks-results`
- `REDIS_BENCHMARK_URL` — Redis connection URL to include Redis in the benchmarks.  
  If omitted, all benchmarks will run in-memory only.

> [!WARNING]
> **Redis Safety Notice**  
> When `REDIS_BENCHMARK_URL` is defined, Cachify will **flush the Redis database** before starting the benchmarks to ensure accurate results.  
> 
> ⚠️ **Never use a production Redis server for benchmarking!**  
> Use a dedicated or disposable Redis instance instead, as **all data will be permanently deleted**.
> 
### Running Benchmarks

Once ready, simply run:

```bash
npm run benchmark
```

This command runs the full benchmark suite and outputs performance results — including read/write throughput and engine comparison — to the directory defined in `BENCHMARK_OUT_DIR` (or the default if not set).
___
## License
This software is licensed under the **Nasriya Personal & Commercial License (NPCL)**, version 1.0.
Please read the license from [here](https://github.com/nasriyasoftware/Cachify?tab=License-1-ov-file).