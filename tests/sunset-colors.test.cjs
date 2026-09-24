const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { Uint8Array, Uint32Array, Math };
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../site/sunset-colors.js'), 'utf8'), context);
const { palette, photoToField } = context.MananaColor;
function color(field) { const p = Math.round((1 - Math.exp(-field * 5.1)) * 4095) * 3; return Array.from(palette.slice(p, p + 3)); }
test('uploaded grayscale produces ordered yellow, orange, red, and brown instead of uniform dark red', () => {
  const shades = [255, 230, 205, 180, 155, 130, 105, 80, 50, 20, 0];
  const pixels = new Uint8Array(shades.flatMap(v => [v, v, v, 255]));
  const field = new Float32Array(shades.length);
  photoToField(pixels, shades.length, 1, field);
  const colors = Array.from(field, color);
  assert.ok(colors[0][1] > 190, 'highlights remain golden');
  assert.ok(colors[5][0] > 230 && colors[5][1] > 95, 'middle tones remain orange');
  assert.ok(colors[colors.length - 1][0] < 170, 'deepest shadows reach brown');
  assert.ok(colors.every((c, i) => i === 0 || c[1] <= colors[i - 1][1]), 'smooth darkening');
  assert.ok(new Set(colors.map(c => c.join(','))).size >= 10, 'meaningful gradation');
});
test('flat bright photos stay light and black photos remain visible', () => {
  for (const [shade, min, max] of [[220, 170, 255], [0, 0, 170]]) {
    const field = new Float32Array(100);
    const pixels = new Uint8Array(Array.from({ length:100 }, () => [shade, shade, shade, 255]).flat());
    photoToField(pixels, 10, 10, field);
    assert.ok(color(field[50])[1] >= min && color(field[50])[1] <= max);
  }
});
