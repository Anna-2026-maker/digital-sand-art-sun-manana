const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(require('node:path').join(__dirname, '../site/wind.js'), 'utf8');
function fixture(mode = 'ok') {
  let clock = 0, amplitude = 0, requests = 0, stopped = 0, closed = 0, snapshots = 0;
  class Element {
    constructor() { this.handlers = {}; this.style = {}; this.hidden = true; this.value = 0; this.classList = { add() {}, remove() {} }; }
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
    setAttribute() {} setPointerCapture() {} querySelector() { return { style: {} }; }
    async fire(type, props = {}) { for (const fn of this.handlers[type] || []) await fn({ preventDefault() {}, stopPropagation() {}, ...props }); }
  }
  const nodes = {}; const document = new Element(); document.getElementById = id => nodes[id] ||= new Element();
  document.getElementById('windSensitivity').value = 60;
  const track = { stop() { stopped++; }, addEventListener() {} };
  const stream = { getTracks: () => [track] };
  let resolveMedia;
  const window = new Element();
  window.AudioContext = class {
    constructor() { this.state = 'running'; }
    resume() { return Promise.resolve(); }
    close() { closed++; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(arr) { for (let i = 0; i < arr.length; i++) arr[i] = i % 2 ? amplitude : -amplitude; } }; }
  };
  const sandbox = { window, document, performance: { now: () => clock }, navigator: { mediaDevices: { getUserMedia() {
    requests++;
    if (mode === 'deny') return Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' }));
    if (mode === 'pending') return new Promise(resolve => { resolveMedia = resolve; });
    return Promise.resolve(stream);
  } } }, Float32Array, Math };
  vm.createContext(sandbox); vm.runInContext(code, sandbox);
  const state = { field: new Float32Array(40 * 40).fill(.5), cols: 40, rows: 40, width: 400, height: 400, size: 48, activePointers: new Map() };
  const history = []; let status = '';
  const control = window.MananaWind.attach({ state, snapshot() { snapshots++; history.push(state.field.slice()); }, status(s) { status = s; }, started() {}, closeDrawer() {}, localPoint: e => ({ x: e.clientX, y: e.clientY }) });
  return { nodes, state, control, window, document, transport: window.MananaWind.transport, history,
    stats: () => ({ requests, stopped, closed, snapshots, status }),
    sound(a) { amplitude = a; },
    tick(n = 1) { for (let i = 0; i < n; i++) { clock += 40; control.tick(40, clock); } },
    resolve() { resolveMedia(stream); } };
}
const sum = a => a.reduce((s, v) => s + v, 0);
test('transport preserves sand and bounds in every direction', () => {
  const { transport } = fixture();
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
    const f = Float32Array.from({ length: 1600 }, (_, i) => .2 + (i % 11) * .1), before = sum(f), source = new Float32Array(f.length);
    for (let i = 0; i < 100; i++) transport(f, 40, 40, 20, 20, a, 8, 1, 40, source);
    assert.ok(Math.abs(sum(f) - before) < .001);
    assert.ok(f.every(v => v >= 0 && v <= 1.450001));
  }
});
test('microphone is opt-in; hold and breath are both required; one undo per hold', async () => {
  const f = fixture(), before = f.state.field.slice();
  assert.equal(f.stats().requests, 0);
  await f.nodes.windToggle.fire('click'); f.tick(35);
  f.sound(.2); f.tick(10); assert.deepEqual(f.state.field, before);
  f.sound(0); await f.nodes.windHold.fire('pointerdown', { pointerId: 1 }); f.tick(10);
  assert.deepEqual(f.state.field, before);
  f.sound(.2); f.tick(30); assert.notDeepEqual(f.state.field, before); assert.equal(f.stats().snapshots, 1);
  assert.deepEqual(f.history[0], before);
  await f.nodes.windHold.fire('pointerup'); const released = f.state.field.slice(); f.tick(20); assert.deepEqual(f.state.field, released);
  await f.nodes.windStop.fire('click'); assert.equal(f.stats().stopped, 1); assert.equal(f.stats().closed, 1); assert.equal(f.nodes.windLive.hidden, true);
});
test('denial cleans up audio and allows retry', async () => {
  const f = fixture('deny'); await f.nodes.windToggle.fire('click');
  assert.equal(f.stats().closed, 1); assert.match(f.stats().status, /未获授权/); assert.equal(f.nodes.windToggle.disabled, false);
});
test('leaving page during permission request stops a late stream', async () => {
  const f = fixture('pending'); const enabling = f.nodes.windToggle.fire('click');
  await Promise.resolve(); await Promise.resolve(); await f.window.fire('pagehide'); f.resolve(); await enabling;
  assert.equal(f.stats().stopped, 1); assert.equal(f.nodes.windLive.hidden, true);
});
test('pause and pointer cancellation stop movement', async () => {
  const f = fixture(); await f.nodes.windToggle.fire('click'); f.tick(35); await f.nodes.windHold.fire('pointerdown'); f.sound(.2); f.tick(10);
  f.state.paused = true; const before = f.state.field.slice(); f.tick(5); assert.deepEqual(f.state.field, before);
  f.state.paused = false; await f.nodes.windHold.fire('pointerdown'); await f.nodes.windHold.fire('pointercancel'); f.tick(10); assert.deepEqual(f.state.field, before);
});

test('a quiet breath makes a strong fan gust at high sensitivity', async () => {
  async function trial(sensitivity, amplitude) {
    const f = fixture();
    f.nodes.windSensitivity.value = sensitivity;
    await f.nodes.windToggle.fire('click');
    f.tick(35);
    await f.nodes.windHold.fire('pointerdown', { pointerId: 1 });
    const before = f.state.field.slice();
    f.sound(amplitude);
    f.tick(12);
    const displacement = f.state.field.reduce((total, value, i) => total + Math.abs(value - before[i]), 0);
    return { displacement, f };
  }
  const lowQuiet = await trial(1, .013);
  const highQuiet = await trial(100, .013);
  assert.equal(lowQuiet.displacement, 0, 'quiet breath stays below low-sensitivity threshold');
  assert.ok(highQuiet.displacement > 5, 'quiet breath has visible effect at high sensitivity');

  const lowStrong = await trial(1, .05);
  const highStrong = await trial(100, .05);
  assert.ok(highStrong.displacement > lowStrong.displacement * 2,
    'slider makes the same breath more than twice as effective');
  assert.equal(highStrong.f.stats().snapshots, 1);
  assert.ok(Math.abs(sum(highStrong.f.state.field) - sum(highStrong.f.history[0])) < .001,
    'the gust redistributes sand without creating or deleting it');
});
