import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PermissionStore } from './permissions.ts'

test('open then has, and getConversation returns the routed conversation', () => {
  const s = new PermissionStore(1000, () => 0)
  s.open('abcde', 'conv-1')
  assert.equal(s.has('abcde'), true)
  assert.equal(s.getConversation('abcde'), 'conv-1')
})

test('has is false for unknown ids', () => {
  const s = new PermissionStore(1000, () => 0)
  assert.equal(s.has('zzzzz'), false)
})

test('close removes the request', () => {
  const s = new PermissionStore(1000, () => 0)
  s.open('abcde', 'c')
  s.close('abcde')
  assert.equal(s.has('abcde'), false)
})

test('has returns false after the TTL elapses', () => {
  let t = 0
  const s = new PermissionStore(1000, () => t)
  s.open('abcde', 'c')
  t = 1001
  assert.equal(s.has('abcde'), false)
})

test('tracks multiple concurrent open requests independently', () => {
  const s = new PermissionStore(1000, () => 0)
  s.open('aaaaa', 'c1')
  s.open('bbbbb', 'c2')
  assert.equal(s.has('aaaaa'), true)
  assert.equal(s.has('bbbbb'), true)
  assert.equal(s.getConversation('bbbbb'), 'c2')
})
