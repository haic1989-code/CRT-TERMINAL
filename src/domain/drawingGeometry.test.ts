import { describe, expect, it } from 'vitest'
import { drawingLogicalAtTime, drawingTimeAtLogical, fibonacciRetracementPrice } from './drawingGeometry'

describe('drawing anchors outside loaded history', () => {
  const bars = [{ time: 1000 }, { time: 1300 }, { time: 2200 }]
  it('keeps existing anchors on their actual timestamps across a trading gap', () => {
    expect(drawingTimeAtLogical(2, bars, 300)).toBe(2200)
    expect(drawingLogicalAtTime(2200, bars, 300)).toBe(2)
    expect(drawingLogicalAtTime(1750, bars, 300)).toBe(1.5)
  })
  it('projects future and past anchors without requiring a loaded candle', () => {
    expect(drawingTimeAtLogical(5, bars, 300)).toBe(3100)
    expect(drawingLogicalAtTime(3100, bars, 300)).toBe(5)
    expect(drawingTimeAtLogical(-2, bars, 300)).toBe(400)
    expect(drawingLogicalAtTime(400, bars, 300)).toBe(-2)
  })
  it('rejects empty history and invalid coordinates', () => {
    expect(drawingTimeAtLogical(3, [], 300)).toBeNull()
    expect(drawingLogicalAtTime(NaN, bars, 300)).toBeNull()
    expect(drawingTimeAtLogical(3, bars, 0)).toBeNull()
  })
})


describe('Fibonacci retracement of a completed impulse', () => {
  it('measures an upward impulse back down from its high', () => {
    expect(fibonacciRetracementPrice(100, 200, 0)).toBe(200)
    expect(fibonacciRetracementPrice(100, 200, 0.236)).toBeCloseTo(176.4)
    expect(fibonacciRetracementPrice(100, 200, 0.382)).toBeCloseTo(161.8)
    expect(fibonacciRetracementPrice(100, 200, 0.618)).toBeCloseTo(138.2)
    expect(fibonacciRetracementPrice(100, 200, 1)).toBe(100)
  })
  it('measures a downward impulse back up from its low', () => {
    expect(fibonacciRetracementPrice(200, 100, 0)).toBe(100)
    expect(fibonacciRetracementPrice(200, 100, 0.236)).toBeCloseTo(123.6)
    expect(fibonacciRetracementPrice(200, 100, 0.382)).toBeCloseTo(138.2)
    expect(fibonacciRetracementPrice(200, 100, 0.618)).toBeCloseTo(161.8)
    expect(fibonacciRetracementPrice(200, 100, 1)).toBe(200)
  })
  it('keeps the half retracement midway in either direction', () => {
    expect(fibonacciRetracementPrice(100, 200, 0.5)).toBe(150)
    expect(fibonacciRetracementPrice(200, 100, 0.5)).toBe(150)
  })
})
