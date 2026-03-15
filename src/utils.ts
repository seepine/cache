import type { TtlValue } from './types'

/**
 * 暂停指定时间（毫秒）
 * @param ms 暂停的时间，单位为毫秒
 * @returns 一个Promise，在指定时间后解析
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 生成指定范围内的随机整数
 * @param min 最小值
 * @param max 最大值
 * @returns 随机整数
 */
export const genRandomInteger = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min

/**
 * 解析TTL值，将字符串格式的TTL转换为秒数
 * @param ttl TTL值，可以是数字（秒）或字符串格式（如 '10s', '5m' 等）
 * @returns TTL的秒数
 */
export const parseTtlSecond = (ttl?: TtlValue): number => {
  if (ttl === undefined) return 0
  if (typeof ttl === 'number') {
    if (!Number.isFinite(ttl) || ttl < 0) {
      throw new Error(`invalid ttl value: ${ttl}`)
    }
    return ttl
  }

  const match = ttl.match(/^(\d+)([ydhms])$/)
  if (!match) throw new Error(`invalid ttl format: ${ttl}`)

  const value = Number(match[1])
  switch (match[2]) {
    case 'y':
      return value * 365 * 24 * 60 * 60
    case 'd':
      return value * 24 * 60 * 60
    case 'h':
      return value * 60 * 60
    case 'm':
      return value * 60
    default:
      // default second
      return value
  }
}
