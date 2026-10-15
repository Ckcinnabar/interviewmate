'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isUsableRegion,
  toImageRegion
} = require('../src/main-process/features/assistant/capture-region');

// A 2560x1440 panel at 125% scaling: the display reports 2048x1152.
const DISPLAY = { width: 2048, height: 1152 };
const IMAGE = { width: 2560, height: 1440 };

test('a selection is scaled from display units to image pixels', () => {
  assert.deepEqual(
    toImageRegion({ x: 100, y: 200, width: 400, height: 300 }, DISPLAY, IMAGE),
    { x: 125, y: 250, width: 500, height: 375 }
  );
});

test('at 100% scaling the selection maps one to one', () => {
  assert.deepEqual(
    toImageRegion({ x: 10, y: 20, width: 300, height: 200 }, { width: 1920, height: 1080 }, { width: 1920, height: 1080 }),
    { x: 10, y: 20, width: 300, height: 200 }
  );
});

test('a selection that runs past the edge is clamped to the screen', () => {
  assert.deepEqual(
    toImageRegion({ x: 1900, y: 1100, width: 400, height: 400 }, DISPLAY, IMAGE),
    { x: 2375, y: 1375, width: 185, height: 65 }
  );
  assert.deepEqual(
    toImageRegion({ x: -50, y: -20, width: 250, height: 120 }, DISPLAY, IMAGE),
    { x: 0, y: 0, width: 250, height: 125 }
  );
});

test('a selection entirely off the screen gives no region', () => {
  assert.equal(toImageRegion({ x: 3000, y: 100, width: 200, height: 200 }, DISPLAY, IMAGE), null);
});

test('a stray click or a malformed selection is not usable', () => {
  assert.equal(isUsableRegion({ x: 5, y: 5, width: 3, height: 200 }), false);
  assert.equal(isUsableRegion({ x: 5, y: 5, width: 200, height: 4 }), false);
  assert.equal(isUsableRegion({ x: NaN, y: 5, width: 200, height: 200 }), false);
  assert.equal(isUsableRegion(null), false);
  assert.equal(isUsableRegion({ x: 5, y: 5, width: 200, height: 100 }), true);

  assert.equal(toImageRegion({ x: 5, y: 5, width: 3, height: 200 }, DISPLAY, IMAGE), null);
  assert.equal(toImageRegion({ x: 5, y: 5, width: 200, height: 100 }, null, IMAGE), null);
});
