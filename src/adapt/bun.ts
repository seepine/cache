import { RedisClient, type RedisOptions } from 'bun'
import { CacheAdapter } from '../types'
export type { RedisOptions } from 'bun'

export class BunRedisAdapter implements CacheAdapter {
  private client: RedisClient
  /**
   * Creates a new Redis client
   *
   * @param url URL to connect to, defaults to `process.env.VALKEY_URL`,
   * `process.env.REDIS_URL`, or `"valkey://localhost:6379"`
   * @param options Additional options
   *
   * @example
   * ```ts
   * const client = new BunRedisAdapter();
   * await client.set("hello", "world");
   * console.log(await client.get("hello"));
   * ```
   */
  constructor(url?: string, options?: RedisOptions) {
    this.client = new RedisClient(url, options)
  }

  async set<T>(
    key: string,
    value: T,
    expireSeconds: number = 0,
  ): Promise<void> {
    const payload = JSON.stringify({ time: Date.now(), data: value })
    const res =
      expireSeconds > 0
        ? await this.client.set(key, payload, 'EX', expireSeconds)
        : await this.client.set(key, payload)
    if (res !== 'OK') {
      throw new Error(
        `set cache failed, key: ${key}, value: ${value}, expireSeconds: ${expireSeconds}`,
      )
    }
  }

  async setnx<T>(key: string, value: T, expireSeconds?: number): Promise<void> {
    const options = ['NX']
    if (expireSeconds !== undefined && expireSeconds > 0) {
      options.push('EX', `${expireSeconds}`)
    }
    const res = await this.client.set(
      key,
      JSON.stringify({
        time: Date.now(),
        data: value,
      }),
      ...options,
    )
    if (res !== 'OK') {
      throw new Error(
        `setnx cache failed, key: ${key}, value: ${value}, expireSeconds: ${expireSeconds}`,
      )
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const data = await this.client.get(key)
    if (!data) {
      return undefined
    }
    try {
      return JSON.parse(data).data as T
    } catch {
      return undefined
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key)
  }

  async expire(key: string, expireSeconds: number): Promise<void> {
    await this.client.expire(key, expireSeconds)
  }

  async clear(namespace: string): Promise<void> {
    const trimmedNamespace = namespace.trim()
    const pattern = trimmedNamespace.length > 0 ? `${trimmedNamespace}:*` : '*'
    const keys = await this.client.keys(pattern)
    if (keys.length > 0) {
      await this.client.del(...keys)
    }
  }

  async close(): Promise<void> {
    this.client.close()
  }
}
