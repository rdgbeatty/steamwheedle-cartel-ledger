import assert from 'node:assert/strict';
import test from 'node:test';
import { priceSegments } from '../public/market-history.mjs';

test('price lines use observed endpoints, with dashed spans across any missing prices', () => {
  const points = [
    { hour: 10, price: null },
    { hour: 12, price: 200 },
    { hour: 13, price: null },
    { hour: 16, price: 160 },
    { hour: 17, price: 175 },
    { hour: 18, price: null }
  ];
  assert.deepEqual(priceSegments(points), [
    { start: points[1], end: points[3], interpolated: true },
    { start: points[3], end: points[4], interpolated: false }
  ]);
  assert.deepEqual(priceSegments(points.slice(0, 3)), []);
});
