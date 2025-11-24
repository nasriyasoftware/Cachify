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
    - [6. Lock Sessions \& Safe Concurrency](#6-lock-sessions--safe-concurrency)
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
Cachify supports **lock sessions**, which allow you to safely acquire and modify cache records in concurrent environments.  

A **session** ensures that only the session which acquires a record can **update** or **remove** it. By default, **reads are blocked** for records acquired by another session, but you can override this behavior with the `blockRead: false` policy.  

Sessions also support configurable **timeouts** to prevent records from being locked indefinitely, and the **exclusive** policy prevents other sessions from acquiring certain records at all.  

Below are short examples illustrating default and custom session behaviors.


```ts
import cachify from '@nasriya/cachify';

const alice = { key: "alice", scope: "users" };

// ------------------------
// 1. Default timeout (10s)
// ------------------------
const session1 = cachify.kvs.createLockSession();
await session1.acquire([alice]);
// session1 will auto-release after 10 seconds if not released manually
session1.release();

// ------------------------
// 2. Infinite timeout
// ------------------------
const session2 = cachify.kvs.createLockSession({ timeout: 0 });
await session2.acquire([alice]);
// session2 will not expire automatically
session2.release();

// ------------------------
// 3. Custom timeout (5s)
// ------------------------
const session3 = cachify.kvs.createLockSession({ timeout: 5000 });
await session3.acquire([alice]);
// session3 will auto-release after 5 seconds if not released manually
session3.release();

// ------------------------
// 4. blockRead: false
// ------------------------
const session4 = cachify.kvs.createLockSession({ policy: { blockRead: false } });
await session4.acquire([alice]);
// Other sessions can read 'alice' even while session4 owns it
session4.release();

// ------------------------
// 5. Exclusive session
// ------------------------
const session5 = cachify.kvs.createLockSession({ policy: { exclusive: true } });
await session5.acquire([alice]);
// Any other session trying to acquire 'alice' will throw immediately
session5.release();
```

> [!NOTE]
> For more detailed examples and usage patterns, check out the [Cachify Wiki](https://github.com/nasriyasoftware/Cachify/wiki).

**Notes:**
- `acquire(records)` ensures **exclusive write access**; only the session that acquires a record can `update` or `remove` it.
- By default, **reads from other sessions are blocked** until the record is released. Use `policy.blockRead: false` to bypass this behavior.
- The **exclusive** policy prevents other sessions from acquiring a record. Attempting to acquire an exclusive record throws an error.
- Sessions have **timeouts** to prevent indefinite locking:
  - Default: 10 seconds
  - Custom: any positive number of milliseconds
  - Infinite: set `timeout: 0`
- Multiple sessions attempting to acquire the same record are **queued and served in order**.
- **Release** a session to free its records for other sessions.

#### Example Use Cases

- **Basic concurrency:** session `S1` acquires record `A`; session `S2` waits to read or acquire until `S1` releases.
- **Blocked reads:** session `S1` acquires a record; other sessions attempting to read will block unless `blockRead: false`.
- **Exclusive records:** records marked as `exclusive` cannot be acquired by other sessions; attempting to do so throws an error.
- **Timeouts:** session automatically releases records when its timeout expires; can be default (10s), custom, or infinite (`timeout: 0`).
- **Safe writes:** only the session that acquired a record can `update` or `remove` it; other sessions attempting these operations will throw an error.

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