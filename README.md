# @seepine/cache

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![License][license-src]][license-href]

轻量缓存工具，支持：

- 纯内存缓存（基于 LRU Cache）
- 通过 Adapter 接入外部缓存（如 Redis）
- 内存 + 外部多级缓存
- 分布式锁（无 Adapter 时自动退化为进程内锁）

## 一、安装

```bash
npm install @seepine/cache
```

## 二、快速开始

### 2.1 内存缓存

无需任何配置，开箱即用：

```ts
import { Cache } from '@seepine/cache'

const cache = new Cache()

await cache.set('k1', 'v1', '30s')
const value = await cache.get('k1') // 'v1'
```

### 2.2 使用 Adapter（以 Bun Redis 为例）

通过 `adapter` 参数传入实现了 `CacheAdapter` 的实例：

```ts
import { Cache } from '@seepine/cache'
import { BunRedisAdapter } from '@seepine/cache/adapt/bun'

const cache = new Cache({
  adapter: new BunRedisAdapter('redis://localhost:6379'),
  namespace: 'my-app',
})
```

### 2.3 自定义 Adapter

实现 `CacheAdapter` 抽象类即可接入任意缓存后端：

```ts
import { Cache, CacheAdapter } from '@seepine/cache'

class MyRedisClient extends CacheAdapter {
  async set<T>(key: string, value: T, expireSeconds?: number) {
    /* ... */
  }
  async setnx<T>(key: string, value: T, expireSeconds?: number) {
    /* ... */
  }
  async get<T>(key: string): Promise<T | undefined> {
    /* ... */
  }
  async del(key: string) {
    /* ... */
  }
  async expire(key: string, expireSeconds: number) {
    /* ... */
  }
  async clear(namespace: string) {
    /* ... */
  }
  async close() {
    /* ... */
  }
}

const cache = new Cache({
  adapter: new MyRedisClient(),
})
```

### 2.4 开启多级缓存（内存 + Adapter）

需要传入 `adapter` 才可启用多级缓存：

```ts
import { Cache } from '@seepine/cache'
import { BunRedisAdapter } from '@seepine/cache/adapt/bun'

const cache = new Cache({
  adapter: new BunRedisAdapter(),
  multiLevelEnabled: true,
  multiLevelTtl: 1000, // 内存层 TTL，单位毫秒
})
```

## 三、API

### 3.1 Constructor Options

| 参数                    | 类型           | 默认值    | 说明                                                |
| ----------------------- | -------------- | --------- | --------------------------------------------------- |
| `adapter`               | `CacheAdapter` | —         | 外部缓存客户端，不传则使用纯内存模式                |
| `namespace`             | `string`       | `'cache'` | 命名空间，键前缀，避免不同应用键冲突                |
| `multiLevelEnabled`     | `boolean`      | `false`   | 是否启用多级缓存（需要传入 `adapter`）              |
| `multiLevelTtl`         | `number`       | `1000`    | 多级缓存中内存层 TTL（毫秒）                        |
| `lockTimeoutSeconds`    | `number`       | `0`       | 锁等待超时（秒），`0` 为无限等待                    |
| `lockAcquireIntervalMs` | `number`       | `100`     | 尝试获取锁的时间间隔（毫秒）                        |
| `lockWatchDogSeconds`   | `number`       | `20`      | 看门狗续期间隔（秒），实际锁过期时间为此值 × 2 + 5s |

### 3.2 方法

| 方法                                | 说明                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `set<T>(key, value, ttl?)`          | 写入缓存。`ttl` 支持秒数（如 `60`）或字符串（`"10s"` / `"5m"` / `"2h"` / `"3d"` / `"1y"`）                                                  |
| `get<T>(key)`                       | 读取缓存，不存在返回 `undefined`                                                                                                            |
| `getOrSet<T>(key, getFn, ttl?)`     | 若 key 有值直接返回；否则加锁后执行 `getFn` 获取并写入缓存后返回                                                                            |
| `del(key)`                          | 删除缓存                                                                                                                                    |
| `clear()`                           | 清空当前命名空间缓存                                                                                                                        |
| `lock<T>(key, fn, timeoutSeconds?)` | 获取锁后执行 `fn`，结束后自动释放。有 Adapter 时使用分布式锁（含自动续约 watchdog），无 Adapter 时使用进程内锁。`timeoutSeconds < 0` 会抛错 |
| `close()`                           | 关闭连接，建议在应用退出前调用                                                                                                              |

### 3.3 TTL 格式

| 格式 | 含义 | 示例         |
| ---- | ---- | ------------ |
| 数字 | 秒   | `60` → 60 秒 |
| `Ns` | 秒   | `"30s"`      |
| `Nm` | 分钟 | `"5m"`       |
| `Nh` | 小时 | `"2h"`       |
| `Nd` | 天   | `"7d"`       |
| `Ny` | 年   | `"1y"`       |

## 四、示例：防止缓存击穿

```ts
import { Cache } from '@seepine/cache'
import { BunRedisAdapter } from '@seepine/cache/adapt/bun'

const cache = new Cache({
  adapter: new BunRedisAdapter(),
  multiLevelEnabled: true,
  multiLevelTtl: 1000,
})

async function getUser(userId: string) {
  // 首次走 DB，之后命中内存缓存，内存过期后走 Adapter 缓存
  return cache.getOrSet(
    `user:${userId}`,
    async () => {
      return await db.user.findById(userId)
    },
    '30s',
  )
}
```

## 五、内置 Adapter

### Bun Redis

基于 Bun 内置的 `Bun.RedisClient`，无需额外依赖：

```ts
import { BunRedisAdapter } from '@seepine/cache/adapt/bun'

// 默认连接 localhost:6379，也支持 REDIS_URL / VALKEY_URL 环境变量
const client = new BunRedisAdapter()

// 或指定地址
const client = new BunRedisAdapter('redis://localhost:6379')
```

<!-- Refs -->

[npm-version-src]: https://img.shields.io/npm/v/@seepine/cache
[npm-version-href]: https://www.npmjs.com/package/@seepine/cache
[npm-downloads-src]: https://img.shields.io/npm/dm/@seepine/cache
[npm-downloads-href]: https://npmjs.com/package/@seepine/cache
[bundle-src]: https://img.shields.io/bundlephobia/minzip/@seepine/cache
[bundle-href]: https://bundlephobia.com/result?p=@seepine/cache
[license-src]: https://img.shields.io/github/license/seepine/cache.svg
[license-href]: https://github.com/seepine/cache/blob/main/LICENSE
