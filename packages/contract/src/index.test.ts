import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVerdictReply, formatVerdictInstruction } from './index.ts'

test('parses an allow verdict with surrounding whitespace and caps', () => {
  assert.deepEqual(parseVerdictReply('  Yes ABCDE '), { requestId: 'abcde', behavior: 'allow' })
})

test('parses short forms y/n', () => {
  assert.deepEqual(parseVerdictReply('y abcde'), { requestId: 'abcde', behavior: 'allow' })
  assert.deepEqual(parseVerdictReply('n abcde'), { requestId: 'abcde', behavior: 'deny' })
})

test('rejects ids containing the letter l and non-verdict text', () => {
  assert.equal(parseVerdictReply('yes ablde'), null)
  assert.equal(parseVerdictReply('please run the build'), null)
  assert.equal(parseVerdictReply('yes'), null)
})

test('formats the reply instruction with the id verbatim', () => {
  assert.equal(formatVerdictInstruction('abcde'), 'Reply "yes abcde" or "no abcde"')
})
