import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Cache } from '.'
import type { CacheAdapter } from '.'
import { LRUCache } from 'lru-cache'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class CustomClient implements CacheAdapter {
  protected store = new LRUCache<string, any>({ max: 999999 })

  async set<T>(key: string, value: T, ttl?: number) {
    this.store.set(key, value, {
      ttl: ttl !== undefined && ttl > 0 ? ttl * 1000 : undefined,
    })
  }

  async setnx<T>(key: string, value: T, ttl?: number) {
    if (this.store.has(key)) {
      throw new Error('key already exists')
    }
    this.store.set(key, value, {
      ttl: ttl !== undefined && ttl > 0 ? ttl * 1000 : undefined,
    })
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined
  }

  async del(key: string) {
    this.store.delete(key)
  }

  async expire(key: string, ttl: number) {
    const value = this.store.get(key)
    if (value === undefined) {
      return
    }
    this.store.set(key, value, {
      ttl: ttl > 0 ? ttl * 1000 : undefined,
    })
  }

  async clear(_namespace: string) {
    this.store.clear()
  }

  async close() {}
}

describe('Cache（adapter 模式）', () => {
  let client: CustomClient
  let cache: Cache

  beforeEach(() => {
    client = new CustomClient()
    cache = new Cache({ adapter: client })
  })

  afterEach(async () => {
    await cache.clear()
    await cache.close()
  })

  it('set 后可以 get 到值', async () => {
    await cache.set('name', 'tom')
    expect(await cache.get('name')).toBe('tom')
  })

  it('set 使用字符串 TTL（1s）后会过期', async () => {
    await cache.set('code', '1234', '1s')
    expect(await cache.get('code')).toBe('1234')

    await sleep(1200)
    expect(await cache.get('code')).toBeUndefined()
  })

  it('close：即使 adapter.close 抛错，也不会抛异常', async () => {
    Object.assign(client, {
      close: async () => {
        throw new Error('close failed')
      },
    })

    await expect(cache.close()).resolves.toBeUndefined()
  })

  it('clear 后当前缓存数据会被清掉', async () => {
    cache = new Cache({ adapter: client, namespace: 'app' })

    await cache.set('name', 'tom')
    await client.set('other:name', 'jack')

    await cache.clear()

    expect(await cache.get('name')).toBeUndefined()
  })

  it('multiLevel 开启时，del 后缓存会失效', async () => {
    cache = new Cache({
      adapter: client,
      multiLevelEnabled: true,
    })

    await cache.set('name', 'tom')
    await cache.del('name')
    expect(await cache.get('name')).toBeUndefined()
  })

  it('multiLevel 开启时，一级缓存命中后即使二级删了也能读到', async () => {
    cache = new Cache({
      adapter: client,
      multiLevelEnabled: true,
    })

    await cache.set('name', 'tom')
    await client.del('cache:name')

    expect(await cache.get('name')).toBe('tom')
  })

  it('multiLevel 开启时，clear 会把一级缓存也清掉', async () => {
    cache = new Cache({
      adapter: client,
      multiLevelEnabled: true,
    })

    await cache.set('name', 'tom')
    await cache.clear()

    expect(await cache.get('name')).toBeUndefined()
  })

  it('multiLevel 开启时，一级缓存未命中会从二级读取并回填', async () => {
    cache = new Cache({
      adapter: client,
      multiLevelEnabled: true,
      multiLevelTtl: 50,
    })

    await cache.set('name', 'tom')

    // 等待一级缓存过期
    await sleep(80)

    // 此时一级缓存已过期，但二级（adapter）仍有值，get 会回填到一级缓存
    expect(await cache.get('name')).toBe('tom')

    // 删除二级缓存，验证一级缓存已被回填
    await client.del('cache:name')
    expect(await cache.get('name')).toBe('tom')
  })
})

describe('Cache.lock（adapter 模式）', () => {
  let client: CustomClient
  let cache: Cache

  beforeEach(() => {
    client = new CustomClient()
    cache = new Cache({ adapter: client, lockAcquireIntervalMs: 5 })
  })

  afterEach(async () => {
    await cache.clear()
    await cache.close()
  })

  it('拿到锁后执行函数，并在结束时释放锁', async () => {
    cache = new Cache({
      adapter: client,
      lockWatchDogSeconds: 0.01,
      lockAcquireIntervalMs: 5,
    })

    const result = await cache.lock(
      'order',
      async () => {
        await sleep(30)
        return 'ok'
      },
      1,
    )

    expect(result).toBe('ok')
    expect(await client.get('cache:lock:order')).toBeUndefined()
  })

  it('超过 timeout 还拿不到锁时会报错', async () => {
    const cache1 = new Cache({ adapter: client, lockAcquireIntervalMs: 5 })
    const cache2 = new Cache({ adapter: client, lockAcquireIntervalMs: 5 })

    const holding = cache1.lock(
      'timeout',
      async () => {
        await sleep(80)
        return 'hold'
      },
      1,
    )

    await sleep(10)

    await expect(cache2.lock('timeout', async () => 'x', 0.02)).rejects.toThrow(
      'lock acquire failed',
    )

    await expect(holding).resolves.toBe('hold')
  })

  it('lock 传入 timeout=0 时也可以正常获取锁', async () => {
    await expect(cache.lock('timeout-zero', async () => 'ok', 0)).resolves.toBe(
      'ok',
    )
  })
})
