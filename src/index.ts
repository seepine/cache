import { Cacheable, Keyv } from 'cacheable'
import KeyvRedis from '@keyv/redis'
import { LRUCache } from 'lru-cache'
import AsyncLock from 'async-lock'

export type CacheOptions = {
  /**
   * URL to connect to, like redis://localhost:6379
   * defaults to process.env.REDIS_URL
   * @default process.env.REDIS_URL
   */
  redisUrl?: string
  /**
   * 缓存命名空间，默认 'cache'
   * 当redisUrl存在时生效，主要用于区分不同应用或模块的缓存，避免键冲突
   * 实际使用时会在键前加上namespace作为前缀，如 'cache:key1'
   * @default 'cache'
   */
  namespace: string
  /**
   * 是否开启多级缓存，当redisUrl存在时生效
   * @default false
   */
  multiLevelEnabled: boolean
  /**
   * 多级缓存中内存缓存的TTL，单位毫秒，TTL过大可能存在数据不一致问题
   * @default 1000
   */
  multiLevelTtl: number
  /**
   * 分布式锁的默认超时时间，单位秒，默认0秒，表示无限等待
   */
  lockTimeoutSeconds: number
  /**
   * 尝试获取锁的时间间隔，单位毫秒，默认100毫秒
   * @default 100
   */
  lockAcquireIntervalMs: number
  /**
   * 看门狗间隔时间，单位秒，默认20秒
   * @default 20
   */
  lockWatchDogSeconds: number
}

type Unit = 'y' | 'd' | 'h' | 'm' | 's'
type StringValue = `${number}${Unit}`

/**
 * 生成指定范围内的随机整数
 * @param min 最小值
 * @param max 最大值
 * @returns 随机整数
 */
function getRandomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export class Cache {
  private cache: Cacheable
  private options: CacheOptions
  private redisStore?: KeyvRedis<unknown>
  private asyncLock: AsyncLock

  private readonly closeOnSignal = () => {
    void this.close()
  }

  constructor(opts?: Partial<CacheOptions>) {
    this.options = {
      redisUrl: opts?.redisUrl,
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
    const redisUrl = this.options.redisUrl || process.env['REDIS_URL']
    if (redisUrl) {
      this.redisStore = new KeyvRedis(redisUrl, { keyPrefixSeparator: ':' })
      if (this.options.multiLevelEnabled === true) {
        const primary = new Keyv({
          ttl: this.options.multiLevelTtl,
          store: new LRUCache({ max: 9999 }),
        })
        this.cache = new Cacheable({
          namespace: this.options.namespace,
          primary,
          secondary: this.redisStore,
        })
      } else {
        this.cache = new Cacheable({
          namespace: this.options.namespace,
          primary: this.redisStore,
        })
      }
      process.on('SIGTERM', this.closeOnSignal)
      process.on('SIGINT', this.closeOnSignal)
    } else {
      const primary = new Keyv({ store: new LRUCache({ max: 999999 }) })
      this.cache = new Cacheable({ namespace: this.options.namespace, primary })
    }
  }

  /**
   * 如果缓存中存在则返回，否则执行getFn获取值并缓存
   * @param key 缓存键
   * @param getFn 获取值的函数
   * @param ttl 过期时间，单位毫秒，也支持字符串格式如 '10s', '5m' 等
   * @returns 缓存值
   */
  async getOrSet<T>(
    key: string,
    getFn: () => Promise<T> | T,
    ttl?: StringValue | number,
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
   * 设置缓存
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl 过期时间，单位毫秒，也支持字符串格式如 '10s', '5m' 等
   * @returns 是否设置成功
   */
  async set<T>(
    key: string,
    value: T,
    ttl?: StringValue | number,
  ): Promise<boolean> {
    return await this.cache.set(key, value, ttl)
  }

  /**
   * 获取缓存值
   * @param key 缓存键
   * @returns 缓存值或undefined
   */
  async get<T>(key: string): Promise<T | undefined> {
    return this.cache.get(key)
  }

  /**
   * 删除缓存
   * @param key 缓存键
   * @returns 是否删除成功
   */
  async del(key: string): Promise<boolean> {
    return await this.cache.delete(key)
  }

  /**
   * 清空缓存
   */
  async clear(): Promise<void> {
    await this.cache.clear()
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
    const client = this.redisStore?.client
    // 若redis未配置，则降级为单机锁
    if (client === undefined) {
      return await this.asyncLock.acquire(lockKey, fn, {
        timeout: timeout,
      })
    }

    const lockValue = `${Date.now()}_${getRandomInteger(1000, 9999)}` // 锁的值，包含时间戳和随机数，确保唯一性

    const acquireTimeoutMs = timeout * 1000 // 锁超时转为毫秒
    const acquireDeadline =
      acquireTimeoutMs > 0 ? Date.now() + acquireTimeoutMs : undefined // 获取锁的截止时间，0或负数表示无限等待

    const watchDogExpireSeconds = this.options.lockWatchDogSeconds * 2 + 5 // 看门狗过期时间，双倍+5秒，确保在锁过期前能续约成功

    // 通过setnx命令尝试获取锁，成功返回true，失败返回false
    const acquireLock = async (): Promise<boolean> => {
      const result = await client.set(lockKey, lockValue, {
        condition: 'NX',
        expiration: { type: 'EX', value: watchDogExpireSeconds },
      })
      return result === 'OK'
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
      await new Promise((resolve) =>
        setTimeout(resolve, this.options.lockAcquireIntervalMs),
      )
    }

    // 成功获取锁，启动看门狗定时器，定期续约锁的过期时间，防止锁过期被其他客户端获取
    const watchDogTimer = setInterval(async () => {
      const currentValue = await client.get(lockKey)
      if (currentValue === lockValue) {
        await client.expire(lockKey, watchDogExpireSeconds)
      }
    }, this.options.lockWatchDogSeconds * 1000)

    try {
      return await fn()
    } finally {
      clearInterval(watchDogTimer)
      // 释放锁，只有持有锁的客户端才能释放
      const currentValue = await client.get(lockKey)
      if (currentValue === lockValue) {
        await client.del(lockKey)
      }
    }
  }

  /**
   * 关闭连接
   */
  async close() {
    try {
      process.off('SIGTERM', this.closeOnSignal)
      process.off('SIGINT', this.closeOnSignal)
      await this.cache.disconnect()
    } catch {}
  }
}
