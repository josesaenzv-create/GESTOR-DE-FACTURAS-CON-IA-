import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCropRect } from './imageProcessor';

test('computeCropRect calculates cropped bounding box accurately and clamps extremes', () => {
  const full = computeCropRect(1000, 2000, { left: 0, top: 0, right: 0, bottom: 0 });
  assert.deepEqual(full, { sx: 0, sy: 0, sw: 1000, sh: 2000 });

  const trimmed = computeCropRect(1000, 2000, {
    left: 0.1,
    right: 0.2,
    top: 0.15,
    bottom: 0.05,
  });
  assert.deepEqual(trimmed, { sx: 100, sy: 300, sw: 700, sh: 1600 });

  const clamped = computeCropRect(1000, 1000, {
    left: 0.9,
    right: 0.9,
    top: -0.2,
    bottom: 0.2,
  });
  assert.deepEqual(clamped, { sx: 450, sy: 0, sw: 100, sh: 800 });
});
