/**
 * @author seepine
 * @description 定义缓存客户端接口和相关类型
 */
export abstract class CacheAdapter {
  /**
   * 设置缓存
   * @param key 缓存键
   * @param value 缓存值
   * @param expireSeconds 过期时间，单位秒
   */
  abstract set<T>(key: string, value: T, expireSeconds?: number): Promise<void>

  /**
   * 设置缓存，如果键不存在则设置成功，存在则不做任何操作
   * @param key 缓存键
   * @param value 缓存值
   * @param expireSeconds 过期时间，单位秒
   */
  abstract setnx<T>(
    key: string,
    value: T,
    expireSeconds?: number,
  ): Promise<void>

  /**
   * 获取缓存值
   * @param key 缓存键
   * @returns 缓存值或undefined
   */
  abstract get<T>(key: string): Promise<T | undefined>

  /**
   * 删除缓存
   * @param key 缓存键
   */
  abstract del(key: string): Promise<void>

  /**
   * 设置缓存过期时间
   * @param key 缓存键
   * @param expireSeconds 过期时间，单位秒
   */
  abstract expire(key: string, expireSeconds: number): Promise<void>

  /**
   * 清除缓存，通常用于测试环境，生产环境慎用
   * @param namespace 命名空间，清除以该命名空间为前缀的所有缓存
   */
  abstract clear(namespace: string): Promise<void>

  /**
   * 关闭缓存连接，通常用于测试环境，生产环境慎用
   */
  abstract close(): Promise<void>
}

export type CacheLockOpts = {
  /**
   * 分布式锁的默认超时时间，单位秒，默认0秒，表示无限等待
   * @default 0
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

export type CacheMultiLevelOpts = {
  /**
   * 是否启用多级缓存，默认false
   * 启用后会在内存中使用LRUCache作为一级缓存，Redis作为二级缓存，读取时先从一级缓存读取，未命中再从二级缓存读取，写入时同时写入一级和二级缓存
   * 适用于读多写少的场景，可以减少Redis访问，提高性能，但可能存在数据不一致的问题（如过期时间不同步）
   * @default false
   */
  multiLevelEnabled: boolean
  /**
   * 多级缓存中内存缓存的TTL，单位毫秒，默认1000ms
   * TTL过大可能存在数据不一致问题，TTL过小可能无法发挥多级缓存的效果，建议根据实际场景调整
   * @default 1000
   */
  multiLevelTtl: number
}

export type CacheBaseOpts = {
  /**
   * 缓存命名空间，默认 'cache'
   * 当redisUrl存在时生效，主要用于区分不同应用或模块的缓存，避免键冲突
   * 实际使用时会在键前加上namespace作为前缀，如 'cache:key1'
   * @default 'cache'
   */
  namespace: string
}

export type CacheOptions = CacheBaseOpts & CacheLockOpts & CacheMultiLevelOpts

export type CacheConstructorOpts = Partial<CacheBaseOpts & CacheLockOpts> &
  (
    | {
        adapter?: CacheAdapter
        multiLevelEnabled?: never
        multiLevelTtl?: never
      }
    | ({ adapter: CacheAdapter } & Partial<CacheMultiLevelOpts>)
  )

type Unit = 'y' | 'd' | 'h' | 'm' | 's'
export type TtlValue = `${number}${Unit}` | number
