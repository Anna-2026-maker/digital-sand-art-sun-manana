/* Sunset palette and photo-to-sand density. No image data leaves this page. */
(function (root) {
  'use strict';
  const stops = [
    [0, 255, 238, 197],
    [.15, 255, 217, 117],
    [.34, 255, 185, 76],
    [.55, 255, 142, 59],
    [.73, 237, 99, 57],
    [.87, 174, 81, 58],
    [1, 95, 52, 37]
  ];
  const palette = new Uint8Array(4096 * 3);
  for (let sample = 0, stop = 0; sample < 4096; sample++) {
    const density = sample / 4095;
    while (stop < stops.length - 2 && density > stops[stop + 1][0]) stop++;
    const a = stops[stop], b = stops[stop + 1];
    const t = (density - a[0]) / (b[0] - a[0]);
    for (let channel = 1; channel <= 3; channel++) {
      palette[sample * 3 + channel - 1] = Math.round(a[channel] + (b[channel] - a[channel]) * t);
    }
  }
  function photoToField(pixels, cols, rows, field) {
    const count = cols * rows;
    const tones = new Uint8Array(count);
    const histogram = new Uint32Array(256);
    for (let i = 0; i < count; i++) {
      const at = i * 4;
      const luminance = Math.round(pixels[at] * .299 + pixels[at + 1] * .587 + pixels[at + 2] * .114);
      tones[i] = luminance;
      histogram[luminance]++;
    }
    // Stretch varied photos gently; keep a fixed scale for nearly flat uploads.
    let low = 0, high = 255, acc = 0;
    for (let value = 0; value < 256; value++) {
      acc += histogram[value];
      if (acc >= count * .05) { low = value; break; }
    }
    acc = 0;
    for (let value = 255; value >= 0; value--) {
      acc += histogram[value];
      if (acc >= count * .05) { high = value; break; }
    }
    const stretch = high - low >= 65;
    for (let i = 0; i < count; i++) {
      const y = Math.floor(i / cols);
      const shadow = stretch ? (high - tones[i]) / (high - low) : 1 - tones[i] / 255;
      const softened = Math.max(0, Math.min(1, shadow + .05 * (y / Math.max(1, rows - 1) - .5)));
      // Most tones remain gold/orange; only the deepest shadows reach brown.
      field[i] = .018 + .30 * Math.pow(softened, .9) + .22 * Math.pow(softened, 5);
    }
  }
  root.MananaColor = { palette, photoToField };
}(typeof window === 'undefined' ? globalThis : window));
