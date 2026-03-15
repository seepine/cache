import { describe, it, expect } from 'vitest'
import { genRandomInteger, parseTtlSecond, sleep } from './utils'

describe('genRandomInteger', () => {
  it('should return a number within the specified range', () => {
    const result = genRandomInteger(1, 10)
    expect(result).toBeGreaterThanOrEqual(1)
    expect(result).toBeLessThanOrEqual(10)
  })

  it('should return an integer', () => {
    const result = genRandomInteger(0, 100)
    expect(Number.isInteger(result)).toBe(true)
  })

  it('should handle single value range', () => {
    const result = genRandomInteger(5, 5)
    expect(result).toBe(5)
  })

  it('should work with negative numbers', () => {
    const result = genRandomInteger(-10, -1)
    expect(result).toBeGreaterThanOrEqual(-10)
    expect(result).toBeLessThanOrEqual(-1)
  })

  it('should work with mixed negative and positive', () => {
    const result = genRandomInteger(-5, 5)
    expect(result).toBeGreaterThanOrEqual(-5)
    expect(result).toBeLessThanOrEqual(5)
  })
})

describe('parseTtlSecond', () => {
  it('should return 0 for undefined', () => {
    expect(parseTtlSecond(undefined)).toBe(0)
  })

  it('should return the same value for numeric input', () => {
    expect(parseTtlSecond(5000)).toBe(5000)
  })

  it('should throw error for negative numeric input', () => {
    expect(() => parseTtlSecond(-1)).toThrow('invalid ttl value')
  })

  it('should throw error for NaN numeric input', () => {
    expect(() => parseTtlSecond(Number.NaN)).toThrow('invalid ttl value')
  })

  it('should parse seconds correctly', () => {
    expect(parseTtlSecond('10s')).toBe(10)
  })

  it('should parse minutes correctly', () => {
    expect(parseTtlSecond('5m')).toBe(5 * 60)
  })

  it('should parse hours correctly', () => {
    expect(parseTtlSecond('2h')).toBe(2 * 60 * 60)
  })

  it('should parse days correctly', () => {
    expect(parseTtlSecond('3d')).toBe(3 * 24 * 60 * 60)
  })

  it('should parse years correctly', () => {
    expect(parseTtlSecond('1y')).toBe(365 * 24 * 60 * 60)
  })

  it('should throw error for invalid format', () => {
    expect(() => parseTtlSecond('10x' as any)).toThrow('invalid ttl format')
    expect(() => parseTtlSecond('abs' as any)).toThrow('invalid ttl format')
    expect(() => parseTtlSecond('10' as any)).toThrow('invalid ttl format')
  })

  it('should throw error for invalid unit', () => {
    expect(() => parseTtlSecond('10w' as any)).toThrow('invalid ttl format')
  })
})

describe('sleep', () => {
  it('should resolve after the specified time', async () => {
    const start = Date.now()
    await sleep(100)
    const end = Date.now()
    expect(end - start).toBeGreaterThanOrEqual(100)
  })
})
