import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Cache } from '.'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function createMockRedisClient(options?: {
  setResults?: Array<'OK' | null>
  getValue?: () => string
}) {
  let lockValue = ''
  const setResults = options?.setResults ?? ['OK']
  let call = 0

  return {
    set: vi.fn(async (_key: string, value: string) => {
      const result = setResults[call] === undefined ? 'OK' : setResults[call]
      call += 1
      if (result === 'OK') {
        lockValue = value
      }
      return result
    }),
    get: vi.fn(async () => options?.getValue?.() ?? lockValue),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  }
}

describe('Base', () => {
  let cache: Cache

  beforeEach(() => {
    cache = new Cache()
  })

  afterEach(async () => {
    await cache.clear()
    vi.restoreAllMocks()
  })

  it('set 后可以 get 到值', async () => {
    await cache.set('key1', 'value1')
    expect(await cache.get('key1')).toBe('value1')
  })

  it('getOrSet：未命中时执行 getFn 并缓存', async () => {
    const getFn = vi.fn(async () => 'value2')

    await expect(cache.getOrSet('key2', getFn)).resolves.toBe('value2')
    await expect(cache.getOrSet('key2', getFn)).resolves.toBe('value2')
    expect(getFn).toHaveBeenCalledTimes(1)
  })

  it('getOrSet：并发时只执行一次 getFn（单飞）', async () => {
    let count = 0
    const getFn = async () => {
      count++
      await sleep(20)
      return 'concurrent-value'
    }

    const [r1, r2, r3] = await Promise.all([
      cache.getOrSet('key-concurrent', getFn),
      cache.getOrSet('key-concurrent', getFn),
      cache.getOrSet('key-concurrent', getFn),
    ])

    expect([r1, r2, r3]).toEqual([
      'concurrent-value',
      'concurrent-value',
      'concurrent-value',
    ])
    expect(count).toBe(1)
  })

  it('getOrSet：返回 undefined 时不缓存', async () => {
    let count = 0
    const getFn = async () => {
      count++
      return undefined
    }

    const r1 = await cache.getOrSet('key-undefined', getFn)
    const r2 = await cache.getOrSet('key-undefined', getFn)

    expect(r1).toBeUndefined()
    expect(r2).toBeUndefined()
    expect(count).toBe(2)
  })

  it('del：删除后读不到值', async () => {
    await cache.set('key-del', 'value-del')
    await expect(cache.del('key-del')).resolves.toBe(true)
    await expect(cache.get('key-del')).resolves.toBeUndefined()
  })

  it('clear：清空后所有键都失效', async () => {
    await cache.set('k1', 'v1')
    await cache.set('k2', 'v2')
    await cache.clear()

    expect(await cache.get('k1')).toBeUndefined()
    expect(await cache.get('k2')).toBeUndefined()
  })

  it('TTL 到期后自动失效', async () => {
    await cache.set('ttl-key', 'ttl-value', 20)
    expect(await cache.get('ttl-key')).toBe('ttl-value')

    await sleep(80)
    expect(await cache.get('ttl-key')).toBeUndefined()
  })

  it('getOrSet：加锁后二次读取命中时不再执行 getFn', async () => {
    const getSpy = vi
      .spyOn(cache, 'get')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('from-lock-cache')
    const getFn = vi.fn(async () => 'from-getFn')
    const setSpy = vi.spyOn(cache, 'set')

    const res = await cache.getOrSet('race-key', getFn)

    expect(res).toBe('from-lock-cache')
    expect(getSpy).toHaveBeenCalledTimes(2)
    expect(getFn).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('构造函数支持 redis 单层/多层配置', async () => {
    const single = new Cache({
      redisUrl: 'redis://127.0.0.1:6379',
      multiLevelEnabled: false,
      namespace: 'test-single',
    })
    const multi = new Cache({
      redisUrl: 'redis://127.0.0.1:6379',
      multiLevelEnabled: true,
      namespace: 'test-multi',
    })

    expect((single as any).redisStore).toBeTruthy()
    expect((multi as any).redisStore).toBeTruthy()

    await (single as any).close()
    await (multi as any).close()
  })
})

describe('lock（无 redis）', () => {
  let cache: Cache

  beforeEach(() => {
    cache = new Cache()
  })

  afterEach(async () => {
    await cache.clear()
    vi.restoreAllMocks()
  })

  it('能执行回调并返回结果', async () => {
    const res = await cache.lock('local-lock', async () => {
      await sleep(10)
      return 'ok'
    })
    expect(res).toBe('ok')
  })

  it('超时时间为负数时抛错', async () => {
    const timeoutCache = new Cache({ lockTimeoutSeconds: -1 })
    await expect(
      timeoutCache.lock('bad-timeout', async () => 'nope'),
    ).rejects.toThrow('timeoutSeconds: must be greater than or equal to 0')
  })

  it('显式 timeout=0 不会回退到默认值', async () => {
    const timeoutCache = new Cache({ lockTimeoutSeconds: -1 })
    await expect(
      timeoutCache.lock('timeout-zero', async () => 'ok', 0),
    ).resolves.toBe('ok')
  })

  it('同一个 key 会串行进入临界区', async () => {
    let inCritical = 0
    let maxInCritical = 0

    const runTask = () =>
      cache.lock('serial-lock', async () => {
        inCritical++
        maxInCritical = Math.max(maxInCritical, inCritical)
        await sleep(20)
        inCritical--
        return 'done'
      })

    const results = await Promise.all([runTask(), runTask(), runTask()])
    expect(results).toEqual(['done', 'done', 'done'])
    expect(maxInCritical).toBe(1)
  })
})

describe('close 相关', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('close 会断开连接并移除信号监听', async () => {
    const closeCache = new Cache()
    const disconnectSpy = vi
      .spyOn((closeCache as any).cache, 'disconnect')
      .mockResolvedValue(undefined)
    const offSpy = vi.spyOn(process, 'off')

    await closeCache.close()

    expect(disconnectSpy).toHaveBeenCalledTimes(1)
    expect(offSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    expect(offSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
  })

  it('close 在 disconnect 失败时不抛错', async () => {
    const closeCache = new Cache()
    vi.spyOn((closeCache as any).cache, 'disconnect').mockRejectedValue(
      new Error('disconnect failed'),
    )

    await expect(closeCache.close()).resolves.toBeUndefined()
  })

  it('closeOnSignal 会触发 close', async () => {
    const signalCache = new Cache()
    const closeSpy = vi
      .spyOn(signalCache as any, 'close')
      .mockResolvedValue(undefined)

    ;(signalCache as any).closeOnSignal()
    await Promise.resolve()

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })
})

describe('lock（redis 分支）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('拿到锁后执行回调并释放锁', async () => {
    const redisLockCache = new Cache()
    const client = createMockRedisClient()

    ;(redisLockCache as any).redisStore = { client }

    const res = await redisLockCache.lock('redis-ok', async () => 'ok', 1)

    expect(res).toBe('ok')
    expect(client.set).toHaveBeenCalledTimes(1)
    expect(client.del).toHaveBeenCalledTimes(1)
  })

  it('首次获取失败时会重试', async () => {
    const redisLockCache = new Cache()
    const timeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((handler) => {
        if (typeof handler === 'function') {
          handler()
        }
        return 1 as unknown as ReturnType<typeof setTimeout>
      })
    const client = createMockRedisClient({ setResults: [null, 'OK'] })

    ;(redisLockCache as any).redisStore = { client }

    const res = await redisLockCache.lock('redis-retry', async () => 'ok', 1)

    expect(res).toBe('ok')
    expect(client.set).toHaveBeenCalledTimes(2)
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100)
  })

  it('超时时间内拿不到锁会抛错', async () => {
    const redisLockCache = new Cache()
    const client = createMockRedisClient({
      setResults: [null, null, null],
      getValue: () => 'x',
    })

    ;(redisLockCache as any).redisStore = { client }

    await expect(
      redisLockCache.lock('redis-timeout', async () => 'no', 0.02),
    ).rejects.toThrow(
      'lock acquire failed, key: redis-timeout, timeoutSeconds: 0.02 while acquiring redis lock',
    )
  })

  it('看门狗会定时续约并在结束时清理定时器', async () => {
    const redisLockCache = new Cache()
    const intervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation((handler) => {
        if (typeof handler === 'function') {
          handler()
        }
        return 1 as unknown as ReturnType<typeof setInterval>
      })
    const clearIntervalSpy = vi
      .spyOn(globalThis, 'clearInterval')
      .mockImplementation(() => undefined)

    const client = createMockRedisClient()
    ;(redisLockCache as any).redisStore = { client }

    const pending = redisLockCache.lock('redis-watchdog', async () => 'ok', 1)

    await expect(pending).resolves.toBe('ok')
    await Promise.resolve()
    expect(client.expire).toHaveBeenCalledTimes(1)
    expect(intervalSpy).toHaveBeenCalledTimes(1)
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
  })
})
