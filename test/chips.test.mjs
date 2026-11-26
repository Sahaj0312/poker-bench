import test from 'node:test';
import assert from 'node:assert/strict';
import {chipCounts, chipPile} from '../dist/chips.js';

test('displayed denominations add up to each balance and keep stacks compact', () => {
  for (const buyIn of [10, 2000, 1000000]) {
    for (const amount of [0, 1, 7, buyIn - 1, buyIn, buyIn * 5 - 1, buyIn * 5]) {
      const chips = chipCounts(amount, buyIn);
      assert.equal(chips.reduce((total, chip) => total + chip.quantity * chip.value, 0), amount);
      assert.ok((chipPile(amount, buyIn).match(/class="chip-tower"/g) || []).length <= 3);
    }
  }
  assert.equal(chipPile(0, 2000), '');
  assert.equal(chipPile(Number.MAX_SAFE_INTEGER, 2000), '');
  assert.notEqual(chipPile(2000, 2000), chipPile(1980, 2000));
});
