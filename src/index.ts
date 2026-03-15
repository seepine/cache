import { LRUCache } from 'lru-cache'
import AsyncLock from 'async-lock'
import type {
  CacheAdapter,
  CacheConstructorOpts,
  CacheOptions,
  TtlValue,
} from './types'
import { genRandomInteger, parseTtlSecond, sleep } from './utils'
export * from './types'

export class Cache {
  private options: CacheOptions
  private asyncLock: AsyncLock
  private isMemoryMode: boolean
  private memoryCache: LRUCache<string, any> | undefined
  private multiCache: LRUCache<string, any> | undefined
  private adapter: CacheAdapter | undefined

  constructor(opts?: CacheConstructorOpts) {
    this.options = {
      namespace: opts?.namespace ?? 'cache',
      multiLevelEnabled: opts?.multiLevelEnabled ?? false,
      multiLevelTtl: opts?.multiLevelTtl ?? 1000,
      lockTimeoutSeconds: opts?.lockTimeoutSeconds ?? 0,
      lockAcquireIntervalMs: opts?.lockAcquireIntervalMs ?? 100,
      lockWatchDogSeconds: opts?.lockWatchDogSeconds ?? 20,
    }
    this.asyncLock = new AsyncLock({
      maxPending: 999999,
    })

    this.isMemoryMode = opts?.adapter === undefined
    if (this.isMemoryMode) {
      this.memoryCache = new LRUCache({ max: 999999 })
    } else {
      this.multiCache = new LRUCache({ max: 999999 })
      this.adapter = opts?.adapter
    }
  }

  /**
   * 设置缓存
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl 过期时间，单位秒，也支持字符串格式如 '10s', '5m' 等
   * @returns 当前实例
   */
  async set<T>(key: string, value: T, ttl?: TtlValue): Promise<this> {
    const ttlSecond = parseTtlSecond(ttl)
    const k = `${this.options.namespace}:cache:${key}`
    if (this.isMemoryMode) {
      this.memoryCache?.set(k, value, {
        ttl: ttlSecond * 1000, // LRUCache的ttl单位是毫秒，而parseTtlSecond返回的是秒，所以需要转换
      })
      return this
    }
    await this.adapter?.set(k, value, ttlSecond)
    if (this.options.multiLevelEnabled) {
      this.multiCache?.set(k, value, {
        ttl: this.options.multiLevelTtl, // 多级缓存的内存层使用 multiLevelTtl，保持短时间缓存
      })
    }
    return this
  }

  /**
   * 获取缓存值
   * @param key 缓存键
   * @returns 缓存值或undefined
   */
  async get<T>(key: string): Promise<T | undefined> {
    const k = `${this.options.namespace}:cache:${key}`
    if (this.isMemoryMode) {
      return this.memoryCache?.get(k)
    }
    if (this.options.multiLevelEnabled) {
      const value = this.multiCache?.get(k)
      if (value !== undefined) {
        return value
      }
    }
    const value = await this.adapter?.get<T>(k)
    if (value !== undefined && this.options.multiLevelEnabled) {
      this.multiCache?.set(k, value, {
        ttl: this.options.multiLevelTtl,
      })
    }
    return value
  }

  /**
   * 删除缓存
   * @param key 缓存键
   */
  async del(key: string): Promise<void> {
    const k = `${this.options.namespace}:cache:${key}`
    if (this.isMemoryMode) {
      this.memoryCache?.delete(k)
      return
    }
    await this.adapter?.del(k)
    if (this.options.multiLevelEnabled) {
      this.multiCache?.delete(k)
    }
    return
  }

  /**
   * 如果缓存中存在则返回，否则执行getFn获取值并缓存
   * @param key 缓存键
   * @param getFn 获取值的函数
   * @param ttl 过期时间，单位秒，也支持字符串格式如 '10s', '5m' 等
   * @returns 缓存值
   */
  async getOrSet<T>(
    key: string,
    getFn: () => Promise<T> | T,
    ttl?: TtlValue,
  ): Promise<T> {
    const cached = await this.get<T>(key)
    if (cached !== undefined) {
      return cached
    }
    return this.lock(key, async () => {
      const existing = await this.get<T>(key)
      if (existing !== undefined) {
        return existing
      }
      const result = await getFn()
      if (result !== undefined) {
        await this.set(key, result, ttl)
      }
      return result
    })
  }
  /**
   * 清空缓存
   */
  async clear(): Promise<void> {
    if (this.isMemoryMode) {
      this.memoryCache?.clear()
      return
    }
    await this.adapter?.clear(this.options.namespace)
    if (this.options.multiLevelEnabled) {
      this.multiCache?.clear()
    }
  }

  /**
   * 分布式锁，获取锁后执行fn，执行完成后自动释放锁
   * @param key 锁的键
   * @param fn 执行的函数
   * @param timeoutSeconds 获取锁超时时间，默认0秒(lockTimeoutSeconds)，表示一直获取锁直到成功
   * @returns 函数执行结果
   */
  async lock<T>(
    key: string,
    fn: () => Promise<T> | T,
    timeoutSeconds?: number,
  ): Promise<T> {
    const lockKey = `${this.options.namespace}:lock:${key}`
    const timeout = timeoutSeconds ?? this.options.lockTimeoutSeconds

    if (timeout < 0) {
      throw new Error(
        `lock cache failed, key: ${key}, timeoutSeconds: must be greater than or equal to 0`,
      )
    }
    const adapter = this.adapter
    // 若redis未配置，则降级为单机锁
    if (adapter === undefined) {
      return await this.asyncLock.acquire(lockKey, fn, {
        timeout: timeout * 1000, // async-lock 期望毫秒，0 * 1000 = 0 仍代表无限等待
      })
    }

    // 锁的值，包含时间戳和随机数，确保唯一性
    const lockValue = `${Date.now()}_${genRandomInteger(1000, 9999)}`

    // 锁超时转为毫秒
    const acquireTimeoutMs = timeout * 1000
    // 获取锁的截止时间，0或负数表示无限等待
    const acquireDeadline =
      acquireTimeoutMs > 0 ? Date.now() + acquireTimeoutMs : undefined
    // 看门狗过期时间，双倍+5秒，确保在锁过期前能续约成功
    const watchDogExpireSeconds = this.options.lockWatchDogSeconds * 2 + 5

    // 通过setnx命令尝试获取锁，成功返回true，失败返回false
    const acquireLock = async (): Promise<boolean> => {
      try {
        await adapter.setnx(lockKey, lockValue, watchDogExpireSeconds)
        return true
      } catch {
        return false
      }
    }
    // 等待获取锁，直到成功或超时
    while (!(await acquireLock())) {
      // 如果设置了超时时间且已经超过了截止时间，则抛出错误
      if (acquireDeadline !== undefined && Date.now() >= acquireDeadline) {
        throw new Error(
          `lock acquire failed, key: ${key}, timeoutSeconds: ${timeout} while acquiring redis lock`,
        )
      }
      // 等待lockAcquireInterval 毫秒后重试获取锁
      await sleep(this.options.lockAcquireIntervalMs)
    }

    // 成功获取锁，启动看门狗定时器，定期续约锁的过期时间，防止锁过期被其他客户端获取
    const watchDogTimer = setInterval(async () => {
      const currentValue = await adapter.get(lockKey)
      if (currentValue === lockValue) {
        await adapter.expire(lockKey, watchDogExpireSeconds)
      }
    }, this.options.lockWatchDogSeconds * 1000)

    try {
      return await fn()
    } finally {
      clearInterval(watchDogTimer)
      // 释放锁，只有持有锁的客户端才能释放
      const currentValue = await adapter.get(lockKey)
      if (currentValue === lockValue) {
        await adapter.del(lockKey)
      }
    }
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    try {
      await this.adapter?.close()
    } catch {}
  }
}
