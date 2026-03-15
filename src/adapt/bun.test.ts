import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { BunRedisAdapter } from './bun'

describe('BunRedisAdapter（基础功能）', () => {
  let client: BunRedisAdapter

  beforeEach(() => {
    client = new BunRedisAdapter()
  })

  afterEach(async () => {
    await client.clear('')
    await client.close()
  })

  it('set 后，get 可以拿到同样的字符串', async () => {
    await client.set('name', 'tom')
    expect(await client.get<string>('name')).toBe('tom')
  })

  it('set 传入过期时间时，1秒后会过期', async () => {
    await client.set('age', '18', 1)
    expect(await client.get<string>('age')).toBe('18')

    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(await client.get('age')).toBeUndefined()
  })

  it('setnx：同一个 key 第二次设置会失败', async () => {
    await client.setnx('only-once', 'first')
    expect(client.setnx('only-once', 'second')).rejects.toThrow(
      'setnx cache failed',
    )
  })

  it('get 在 key 不存在时返回 undefined', async () => {
    expect(await client.get('not-exists')).toBeUndefined()
  })

  it('del 后就读不到值', async () => {
    await client.set('session', 'ok')
    await client.del('session')
    expect(await client.get('session')).toBeUndefined()
  })

  it('clear(前缀) 只会清理这个前缀的数据', async () => {
    const ns = 'user'
    const keyA = `${ns}:name`
    const keyB = `${ns}:age`
    const otherKey = 'order:id'

    await client.set(keyA, 'tom')
    await client.set(keyB, '18')
    await client.set(otherKey, '1001')
    await client.clear(ns)

    expect(await client.get(keyA)).toBeUndefined()
    expect(await client.get(keyB)).toBeUndefined()
    expect(await client.get<string>(otherKey)).toBe('1001')
  })

  it("clear('') 可以清空全部数据", async () => {
    await client.set('name', 'tom')
    await client.set('user:age', '18')

    await client.clear('')

    expect(await client.get('name')).toBeUndefined()
    expect(await client.get('user:age')).toBeUndefined()
  })
})

describe('BunRedisAdapter.close', () => {
  it('close 可以正常调用', async () => {
    const client = new BunRedisAdapter()
    await expect(client.close()).resolves.toBeUndefined()
  })
})
