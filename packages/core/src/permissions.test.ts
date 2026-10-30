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
  assert.equal(s.getConversation('zzzzz'), undefined)
})

test('close removes the request', () => {
  const s = new PermissionStore(1000, () => 0)
  s.open('abcde', 'c')
  s.close('abcde')
  assert.equal(s.getConversation('abcde'), undefined)
  assert.equal(s.has('abcde'), false)
})

test('an open request can have an undefined conversation', () => {
  const s = new PermissionStore(1000, () => 0)
  s.open('abcde', undefined)
  assert.equal(s.getConversation('abcde'), undefined)
  assert.equal(s.has('abcde'), true)
})

test('has returns false after the TTL elapses', () => {
  let t = 0
  const s = new PermissionStore(1000, () => t)
  s.open('abcde', 'c')
  t = 1001
  assert.equal(s.has('abcde'), false)
})

test('getConversation expires a request without a prior has call', () => {
  let t = 0
  const s = new PermissionStore(1000, () => t)
  s.open('abcde', 'c')
  t = 999
  assert.equal(s.getConversation('abcde'), 'c')
  t = 1001
  assert.equal(s.getConversation('abcde'), undefined)
  assert.equal(s.has('abcde'), false)
})

test('a request remains valid at the exact TTL boundary', () => {
  let t = 0
  const s = new PermissionStore(1000, () => t)
  s.open('abcde', 'c')
  t = 1000
  assert.equal(s.getConversation('abcde'), 'c')
  assert.equal(s.has('abcde'), true)
  t = 1001
  assert.equal(s.getConversation('abcde'), undefined)
  assert.equal(s.has('abcde'), false)
})

test('getConversation expires requests independently', () => {
  let t = 0
  const s = new PermissionStore(1000, () => t)
  s.open('aaaaa', 'c1')
  t = 500
  s.open('bbbbb', 'c2')
  t = 1001
  assert.equal(s.getConversation('aaaaa'), undefined)
  assert.equal(s.getConversation('bbbbb'), 'c2')
  assert.equal(s.has('aaaaa'), false)
  assert.equal(s.has('bbbbb'), true)
  t = 1501
  assert.equal(s.getConversation('bbbbb'), undefined)
  assert.equal(s.has('bbbbb'), false)
})

test('tracks multiple concurrent open requests independently', () => {
  const s = new PermissionStore(1000, () => 0)
  s.open('aaaaa', 'c1')
  s.open('bbbbb', 'c2')
  assert.equal(s.has('aaaaa'), true)
  assert.equal(s.has('bbbbb'), true)
  assert.equal(s.getConversation('bbbbb'), 'c2')
})
