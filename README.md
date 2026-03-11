# @seepine/cache

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![License][license-src]][license-href]

轻量缓存工具，支持：

- 纯内存缓存
- Redis 缓存
- Redis + 内存多级缓存
- 分布式锁（无 Redis 时自动退化为进程内锁）

## 一、安装

```bash
npm install @seepine/cache
```

## 二、快速开始

### 2.1 内存缓存

```ts
import { Cache } from '@seepine/cache'

const cache = new Cache()

await cache.set('k1', 'v1', '30s')
const value = await cache.get('k1')
```

### 2.2 使用 Redis

```ts
import { Cache } from '@seepine/cache'

const cache = new Cache({
  redisUrl: 'redis://localhost:6379',
  namespace: 'my-app',
})
```

也可以不传 `redisUrl`，改为使用环境变量：

```bash
REDIS_URL=redis://localhost:6379
```

### 2.3 开启多级缓存（内存 + Redis）

```ts
import { Cache } from '@seepine/cache'

const cache = new Cache({
  redisUrl: 'redis://localhost:6379',
  multiLevelEnabled: true,
  multiLevelTtl: 1000,
})
```

## 三、API

### 3.1 Options

| 参数                               | 类型      | 默认值                  | 说明                             |
| ---------------------------------- | --------- | ----------------------- | -------------------------------- |
| `redisUrl`                         | `string`  | `process.env.REDIS_URL` | Redis 地址                       |
| `namespace`                        | `string`  | `'cache'`               | 命名空间                         |
| `multiLevelEnabled`                | `boolean` | `false`                 | 是否启用多级缓存                 |
| `multiLevelTtl`                    | `number`  | `1000`                  | 多级缓存中内存层 TTL（毫秒）     |
| `lockTimeoutSeconds`               | `number`  | `0`                     | 锁等待超时（秒），`0` 为无限等待 |
| `lockAcquireInterval`              | `number`  | `100`                   | 尝试获取锁的时间间隔（毫秒）     |
| `lockWatchDogSeconds`              | `number`  | `45`                    | 看门狗超时时间（秒）             |
| `lockWatchDogRenewIntervalSeconds` | `number`  | `20`                    | 看门狗续约间隔（秒）             |

### 3.2 方法

| 方法                                | 说明                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `get<T>(key)`                       | 读取缓存，不存在返回 `undefined`                                                                                                            |
| `set<T>(key, value, ttl?)`          | 写入缓存，返回是否成功。`ttl` 支持毫秒数字（如 `5000`）或字符串（如 `"10s"`、`"5m"`、`"1h"`）                                               |
| `getOrSet<T>(key, getFn, ttl?)`     | 若 key 有值直接返回；否则执行 `getFn` 获取并写入缓存后返回                                                                                  |
| `del(key)`                          | 删除缓存，返回是否成功                                                                                                                      |
| `clear()`                           | 清空当前命名空间缓存                                                                                                                        |
| `lock<T>(key, fn, timeoutSeconds?)` | 获取锁后执行 `fn`，执行结束自动释放锁。有 Redis 时使用分布式锁（含自动续约 watchdog），无 Redis 时使用进程内锁。`timeoutSeconds < 0` 会抛错 |
| `close()`                           | 关闭连接并移除进程信号监听，建议在应用退出前调用                                                                                            |

## 四、示例：防止缓存击穿

```ts
import { Cache } from '@seepine/cache'

const cache = new Cache({
  redisUrl: 'redis://localhost:6379',
  // 开启多级缓存
  multiLevelEnabled: true,
  // 多级缓存中内存缓存的TTL，单位毫秒
  multiLevelTtl: 1000,
})

async function getUser(userId: string) {
  // 初次会走db，下一次命中会走内存缓存，内存缓存1000毫秒过期后会走redis缓存
  return cache.getOrSet(
    `user:${userId}`,
    async () => {
      const user = await db.user.findById(userId)
      return user
    },
    '30s',
  )
}
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
