<img src="./.github/assets/Cachify_Full_Logo.svg" height="80px" alt="Cachify Logo" center>

# Cachify
Cachify is a fast, flexible caching library for Node.js supporting key-value and file caching with multi-storage and lifecycle management.

[![NPM License](https://img.shields.io/npm/l/%40nasriya%2Fcachify?color=lightgreen)](https://github.com/nasriyasoftware/Cachify?tab=License-1-ov-file) ![NPM Version](https://img.shields.io/npm/v/%40nasriya%2Fcachify) ![NPM Unpacked Size](https://img.shields.io/npm/unpacked-size/%40nasriya%2Fcachify) ![Last Commit](https://img.shields.io/github/last-commit/nasriyasoftware/Cachify.svg) [![Status](https://img.shields.io/badge/Status-Stable-lightgreen.svg)](link-to-your-status-page)

##### Visit us at [www.nasriya.net](https://nasriya.net).

Made with ❤️ in **Palestine** 🇵🇸

___
## Overview

Cachify is a **fast, flexible caching library for Node.js** that supports:

- **Key-value and file caching**  
- **Multiple storage backends** (memory, Redis, or custom engines)  
- **Automatic file lifecycle management**  
- **Persistence and cold-start recovery**  

Cachify makes caching **simple, reliable, and extensible**, giving developers a unified API for all caching needs.

> [!IMPORTANT]
> 
> 🌟 **Support Our Open-Source Development!** 🌟
> We need your support to keep our projects going! If you find our work valuable, please consider contributing. Your support helps us continue to develop and maintain these tools.
> 
> **[Click here to support us!](https://fund.nasriya.net/)**
> 
> Every contribution, big or small, makes a difference. Thank you for your generosity and support!

___

## Why Cachify?

Cachify is designed to go **beyond traditional key-value caching** like Redis. While Redis is powerful, Cachify provides unique features that make it ideal for certain use cases:

- **Unified caching for keys and files**  
  Cachify handles **both key-value pairs and files**. You can even store files in Redis or other backends without extra effort — developers just pass the file path, and Cachify retrieves it automatically.

- **Multi-storage support**  
  Combine **memory, Redis, and custom storage engines** with redundancy, fast reads, and failover out of the box.

- **Automated file lifecycle management**  
  Cached files are automatically **revalidated on changes** and **removed when deleted**, saving you from writing extra housekeeping logic.

- **Persistence & cold-start recovery**  
  With **backup and restore adapters**, your cache survives application restarts, providing near-instant startup without rebuilding the cache.

- **Extensibility**  
  Implement **custom storage engines** and integrate them seamlessly. Cachify is flexible and adaptable to your architecture.

- **Fastest read-first strategy**  
  When reading from multiple backends, Cachify returns the **first successful response**, optimizing latency automatically.

---

## When to Use Cachify Instead of Just Redis

- You need **file caching in memory or Redis**, with **automatic retrieval by file path**.  
- You want **automatic file revalidation** without writing extra watchers.  
- Your application requires **multi-storage redundancy** or **fastest-response reads** across multiple backends.  
- You need **persistent caching** that survives cold starts without rebuilding.  
- You want a **Node.js-native, highly extensible caching library** that works with Redis but also handles scenarios Redis alone cannot.

---
## Installation

```bash
npm install @nasriya/cachify
```

## 2. Importing
Importing in **ESM** modules
```js
import cachify from '@nasriya/cachify';
```

Importing in **CommonJS** modules
```js
const cachify = require('@nasriya/cachify').default;
```
---

## Usage
```js
import cachify from '@nasriya/cachify';

// Setting and reading a key-value pair
await cachify.kv.set('key', 'value');           // Set a key-value pair in memory
const value = await cachify.kv.get('key');      // Get a key-value pair from memory
console.log(value);                             // Output: 'value'

// Setting and reading a file
await cachify.files.set('path/to/file');        // Set a file cache record in memory

// Inspect a file cache record from memory
const fileRecord = await cachify.files.inspect({ filePath: 'path/to/file' });

// Read a file from memory
const readResult = await cachify.files.read({ filePath: 'path/to/file' }); 
console.log(readResult);
/**
 * {
 *    "status": "miss" | "hit",
 *    "content": Buffer
 * }
 */
```

### Using Redis as storage engine
```js
import cachify from '@nasriya/cachify';

cachify.engines.useRedis('redis-eu', redisEU);
cachify.engines.useRedis('redis-us', redisUS);

// Setting and reading a key-value pair
await cachify.kv.set('foo1', 'bar1', { storeIn: ['redis-eu', 'redis-us'] });
await cachify.kv.set('foo2', 'bar2', { storeIn: ['memory', 'redis-eu', 'redis-us'] });

const foo1 = await cachify.kv.get('foo1');
const foo2 = await cachify.kv.get('foo2');

console.log(foo1); // Output: 'bar1'
console.log(foo2); // Output: 'bar2'
```

**Notes:**
- **`storeIn`**: Specify which storage engines to write to. Cachify will store the value in **all selected backends**.  
- **Fastest read wins**: When reading, Cachify queries all available storages and returns the **first successful result**.  
- **Redundancy**: Using multiple Redis servers ensures **high availability** — if one fails, the other can serve the request.  
- Works with **key-value caching** and **file caching**.

### Persistence / Cold Start Recovery
Cachify supports persistent caching, allowing you to backup and restore the entire cache — including both key-value pairs and files. This ensures your application can recover cached data after a cold start.

```js
import cachify from '@nasriya/cachify';
import path from "path";

const backupFileName = 'cars';
const testFilePath = path.join(process.cwd(), 'test', 'sample.txt');

// Register the local persistence adapter
cachify.persistence.use('local', { path: process.cwd() });

// ----------------------------
// Setting cache records
// ----------------------------
await cachify.kv.set('a', 1);
await cachify.files.set(testFilePath);

// ----------------------------
// Backup cache
// ----------------------------
await cachify.persistence.backup('local', backupFileName);
console.log('Backup complete.');

// ----------------------------
// Clear in-memory cache
// ----------------------------
await cachify.clear();
console.log('Cache cleared.');

// ----------------------------
// Restore cache
// ----------------------------
await cachify.persistence.restore('local', backupFileName);
console.log('Cache restored.');

// ----------------------------
// Access restored data
// ----------------------------
console.log(await cachify.kv.get('a'));          // Output: 1
const fileResponse = await cachify.files.read({ filePath: testFilePath });
console.log(fileResponse);
/**
 * {
 *    status: "hit" | "miss",
 *    content: Buffer
 * }
 */
```

**Notes:**
- **Backup**: Saves the entire cache (key-value and files) to the configured persistence adapter.  
- **Restore**: Reloads all cached data, enabling seamless recovery after a cold start.  
- Currently supports the **`local` adapter**; cloud adapters (e.g., S3) are planned.  
- Works with **all cache flavors**, providing redundancy and fast cold-start recovery.

___
## License
This software is licensed under the **Nasriya Personal & Commercial License (NPCL)**, version 1.0.
Please read the license from [here](https://github.com/nasriyasoftware/Cachify?tab=License-1-ov-file).