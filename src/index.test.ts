import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Cache } from '.'
import { sleep } from './utils'

describe('Cache（基础功能）', () => {
  let cache: Cache

  beforeEach(() => {
    cache = new Cache()
  })

  afterEach(async () => {
    await cache.clear()
    await cache.close()
  })

  it('set 后可以 get 到值', async () => {
    await cache.set('name', 'tom')
    expect(await cache.get('name')).toBe('tom')
  })

  it('del 后就读不到值', async () => {
    await cache.set('name', 'tom')
    await cache.del('name')
    expect(await cache.get('name')).toBeUndefined()
  })

  it('clear 后，所有 key 都会被清掉', async () => {
    await cache.set('name', 'tom')
    await cache.set('age', 18)

    await cache.clear()

    expect(await cache.get('name')).toBeUndefined()
    expect(await cache.get('age')).toBeUndefined()
  })

  it('TTL 到期后会自动失效', async () => {
    await cache.set('token', 'ok', 0.05)
    expect(await cache.get('token')).toBe('ok')

    await sleep(120)
    expect(await cache.get('token')).toBeUndefined()
  })

  it('支持字符串 TTL（1s）', async () => {
    await cache.set('code', '1234', '1s')
    expect(await cache.get('code')).toBe('1234')

    await sleep(1200)
    expect(await cache.get('code')).toBeUndefined()
  })

  it('getOrSet：第一次执行函数，第二次直接读缓存', async () => {
    let count = 0
    const getFn = async () => {
      count += 1
      return 'hello'
    }

    expect(await cache.getOrSet('greet', getFn)).toBe('hello')
    expect(await cache.getOrSet('greet', getFn)).toBe('hello')
    expect(count).toBe(1)
  })

  it('getOrSet：当函数返回 undefined 时不缓存', async () => {
    let count = 0
    const getFn = async () => {
      count += 1
      return undefined
    }

    expect(await cache.getOrSet('empty', getFn)).toBeUndefined()
    expect(await cache.getOrSet('empty', getFn)).toBeUndefined()
    expect(count).toBe(2)
  })

  it('getOrSet：加锁后如果别人已写入，直接返回已存在值', async () => {
    const originalGet = cache.get.bind(cache)
    let getCount = 0
    let getFnCalled = false

    ;(cache as any).get = async (key: string) => {
      getCount += 1
      if (getCount === 1) {
        return undefined
      }
      if (getCount === 2) {
        return 'from-cache'
      }
      return originalGet(key)
    }

    const value = await cache.getOrSet('race-key', async () => {
      getFnCalled = true
      return 'from-fn'
    })

    expect(value).toBe('from-cache')
    expect(getFnCalled).toBe(false)
  })
})

describe('Cache.lock（无 adapter）', () => {
  let cache: Cache

  beforeEach(() => {
    cache = new Cache()
  })

  afterEach(async () => {
    await cache.clear()
    await cache.close()
  })

  it('同一个 key 会串行执行', async () => {
    let running = 0
    let maxRunning = 0

    const runTask = () =>
      cache.lock('order', async () => {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        await sleep(20)
        running -= 1
        return 'ok'
      })

    const result = await Promise.all([runTask(), runTask(), runTask()])

    expect(result).toEqual(['ok', 'ok', 'ok'])
    expect(maxRunning).toBe(1)
  })

  it('超时时间小于 0 时会报错', async () => {
    const badCache = new Cache({ lockTimeoutSeconds: -1 })

    await expect(badCache.lock('bad', async () => 'x')).rejects.toThrow(
      'timeoutSeconds: must be greater than or equal to 0',
    )
  })
})
