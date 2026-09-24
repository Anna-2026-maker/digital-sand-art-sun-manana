/* Local-only microphone analysis and conservative sand transport. */
(function (root) {
  'use strict';
  function transport(field, cols, rows, cx, cy, angle, radius, power, dt, source) {
    if (power <= 0 || radius <= 0 || dt <= 0) return 0;
    source.set(field);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const reach = radius * 2.5;
    const step = 1 + power * 4.5;
    const sx = Math.round(dx * step), sy = Math.round(dy * step);
    let moved = 0;
    const rate = Math.min(.72, dt / 1000 * (1 + power * 9));
    // Scan the rotated fan's bounding box instead of a large square around it.
    let minX = cols - 1, maxX = 0, minY = rows - 1, maxY = 0;
    for (const along of [-radius * .2, reach]) {
      for (const across of [-radius, radius]) {
        const x = cx + along * dx - across * dy;
        const y = cy + along * dy + across * dx;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(rows - 1, Math.ceil(maxY)); y++) {
      for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(cols - 1, Math.ceil(maxX)); x++) {
        const rx = x - cx, ry = y - cy;
        const along = rx * dx + ry * dy, across = -rx * dy + ry * dx;
        if (along < -radius * .2 || along > reach) continue;
        const width = radius * (.45 + .55 * Math.max(0, along) / reach);
        const weight = Math.max(0, 1 - Math.abs(across) / width) * Math.max(0, 1 - Math.max(0, along) / reach);
        if (!weight) continue;
        const tx = x + sx, ty = y + sy;
        if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
        const i = y * cols + x, j = ty * cols + tx;
        const amount = Math.max(0, Math.min(source[i] * rate * weight, field[i], 1.45 - field[j]));
        field[i] -= amount;
        field[j] += amount;
        moved += amount;
      }
    }
    return moved;
  }

  // The slider controls the audible threshold AND the size and strength of the gust.
  function response(rms, floor, sensitivity) {
    const level = Math.max(0, Math.min(1, (sensitivity - 1) / 99));
    const threshold = Math.max(.004, floor * (2.7 - 1.55 * level) + (1 - level) * .006);
    const signal = Math.max(0, (rms - threshold) / Math.max(.004, threshold * (1.6 - 1.1 * level)));
    return {
      signal: Math.min(1, signal),
      radiusFactor: .75 + 1.5 * level * level,
      strengthFactor: .45 + 2.4 * level * level
    };
  }

  function attach(api) {
    const get = id => document.getElementById(id);
    const toggle = get('windToggle'), hold = get('windHold'), stop = get('windStop');
    const dock = get('windLive'), nozzle = get('windNozzle'), meter = get('windMeter');
    const message = get('windMessage'), sensitivity = get('windSensitivity'), direction = get('windDirection');
    const sensitivityValue = get('windSensitivityValue');
    let stream = null, context = null, analyser = null, input = null, samples = null;
    let enabled = false, pending = false, generation = 0, held = false, captured = false;
    let floor = .006, smooth = 0, sustained = 0, calibratedAt = 0, lastTransportAt = 0;
    let pos = { x: .5, y: .55 }, drag = null, source = new Float32Array(0);

    function release() {
      held = false; captured = false; sustained = 0; smooth = 0; lastTransportAt = 0;
      hold.classList.remove('blowing'); hold.setAttribute('aria-pressed', 'false');
      meter.value = 0;
    }
    function shutdown() {
      generation++; pending = false; enabled = false; release(); drag = null;
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (input) input.disconnect();
      if (context) context.close().catch(() => {});
      stream = context = analyser = input = samples = null;
      dock.hidden = nozzle.hidden = true;
      toggle.textContent = '开启麦克风吹沙'; toggle.disabled = false;
      toggle.setAttribute('aria-pressed', 'false');
    }
    function position() {
      nozzle.style.left = pos.x * 100 + '%'; nozzle.style.top = pos.y * 100 + '%';
      nozzle.querySelector('span').style.transform = 'rotate(' + direction.value + 'deg)';
      get('windDirectionValue').textContent = direction.value + '°';
    }
    async function enable() {
      if (enabled || pending) { shutdown(); return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
        api.status('此浏览器不支持麦克风吹沙，请用 Safari 或 Chrome 打开 HTTPS 网页'); return;
      }
      const token = ++generation; pending = true; toggle.disabled = true;
      toggle.textContent = '等待麦克风授权…';
      try {
        // Create/resume during the user gesture for Safari. Never connect to speakers.
        context = new (window.AudioContext || window.webkitAudioContext)();
        await context.resume();
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
        if (token !== generation) { acquired.getTracks().forEach(t => t.stop()); return; }
        stream = acquired; input = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser(); analyser.fftSize = 2048;
        input.connect(analyser); samples = new Float32Array(analyser.fftSize);
        // iPad Safari may suspend the context while the system permission sheet is open.
        context.resume().catch(() => {});
        stream.getTracks().forEach(t => t.addEventListener('ended', shutdown));
        pending = false; enabled = true; toggle.disabled = false;
        toggle.textContent = '关闭麦克风吹沙'; toggle.setAttribute('aria-pressed', 'true');
        dock.hidden = nozzle.hidden = false; floor = .006;
        calibratedAt = performance.now() + 1200;
        message.textContent = '先保持安静 1 秒，正在适应现场声音';
        api.state.activePointers.clear(); position(); api.closeDrawer();
      } catch (error) {
        if (token !== generation) return;
        shutdown();
        api.status(error.name === 'NotAllowedError' ? '麦克风未获授权，可在浏览器网站设置中允许后重试' : '麦克风暂时不可用，请检查设备或关闭占用麦克风的应用后重试');
      }
    }
    function press(event) {
      event.preventDefault(); event.stopPropagation();
      if (!enabled || performance.now() < calibratedAt || api.state.paused) return;
      if (context.state !== 'running') context.resume().catch(() => {});
      if (held) return;
      held = true; captured = false; sustained = 0; api.state.activePointers.clear();
      hold.setAttribute('aria-pressed', 'true'); hold.classList.add('blowing');
      message.textContent = '对着麦克风吹气，松手停止';
      if (event.pointerId !== undefined) hold.setPointerCapture(event.pointerId);
    }
    toggle.addEventListener('click', enable);
    stop.addEventListener('click', () => { shutdown(); api.status('麦克风已关闭'); });
    hold.addEventListener('pointerdown', press);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => hold.addEventListener(type, release));
    hold.addEventListener('keydown', event => { if (event.code === 'Space' || event.code === 'Enter') press(event); });
    hold.addEventListener('keyup', event => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); release(); } });
    hold.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('visibilitychange', () => { if (document.hidden) shutdown(); });
    window.addEventListener('pagehide', shutdown);
    window.addEventListener('blur', release);
    direction.addEventListener('input', position);
    sensitivity.addEventListener('input', () => { sensitivityValue.textContent = sensitivity.value + '%'; });
    get('windSettings').addEventListener('pointerdown', event => event.stopPropagation());
    nozzle.addEventListener('pointerdown', event => {
      event.preventDefault(); event.stopPropagation(); release();
      api.state.activePointers.clear(); drag = event.pointerId; nozzle.setPointerCapture(drag);
    });
    nozzle.addEventListener('pointermove', event => {
      if (drag !== event.pointerId) return;
      const point = api.localPoint(event);
      pos = { x: Math.max(0, Math.min(1, point.x / api.state.width)), y: Math.max(0, Math.min(1, point.y / api.state.height)) }; position();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => nozzle.addEventListener(type, () => { drag = null; }));
    nozzle.addEventListener('keydown', event => {
      const delta = { ArrowLeft: [-.025, 0], ArrowRight: [.025, 0], ArrowUp: [0, -.025], ArrowDown: [0, .025] }[event.key];
      if (!delta) return;
      event.preventDefault(); event.stopPropagation();
      pos.x = Math.max(0, Math.min(1, pos.x + delta[0])); pos.y = Math.max(0, Math.min(1, pos.y + delta[1])); position();
    });
    function tick(dt, now) {
      if (!enabled || !analyser) return;
      if (context.state !== 'running') { message.textContent = '正在恢复麦克风，请继续按住'; return; }
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (let i = 0; i < samples.length; i++) {
        energy += samples[i] * samples[i];
      }
      const rms = Math.sqrt(energy / samples.length);
      if (!held) floor = Math.max(.006, floor * .96 + Math.min(.12, rms) * .04);
      if (now < calibratedAt) return;
      if (!held || api.state.paused) { release(); message.textContent = api.state.paused ? '已暂停创作' : '拖动风口 · 按住下方按钮并吹气'; return; }
      const settings = response(rms, floor, Number(sensitivity.value));
      // The user must hold the button and produce sustained sound above room noise.
      const candidate = settings.signal > 0;
      sustained = candidate ? sustained + Math.min(dt, 50) : 0;
      const target = sustained > 80 ? settings.signal : 0;
      smooth = smooth * .55 + target * .45;
      const gust = Math.min(2.8, smooth * settings.strengthFactor);
      meter.value = gust / 2.8;
      if (smooth < .025) return;
      if (lastTransportAt && now - lastTransportAt < 80) return;
      const s = api.state;
      if (!captured) { api.snapshot(); captured = true; api.started(); }
      if (source.length !== s.field.length) source = new Float32Array(s.field.length);
      const radius = Math.min(145, Math.max(8, s.size * 2) * settings.radiusFactor) * s.cols / s.width;
      const elapsed = lastTransportAt ? Math.min(80, now - lastTransportAt) : Math.max(40, dt);
      lastTransportAt = now;
      transport(s.field, s.cols, s.rows, pos.x * (s.cols - 1), pos.y * (s.rows - 1), Number(direction.value) * Math.PI / 180, radius, gust, elapsed, source);
    }
    return { tick, release, busy: () => held || drag !== null };
  }
  root.MananaWind = { transport, response, attach };
}(typeof window === 'undefined' ? globalThis : window));
