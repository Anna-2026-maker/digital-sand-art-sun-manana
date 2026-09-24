"use client";
import { useEffect, useRef, useState } from "react";

  // Density-to-colour lookup: warm light, gold, orange, vermilion, wine shadow.
  // Precomputed once; the drawing simulation and sparse-grain mask stay unchanged.
  const sunsetStops = [
    [0, 255, 235, 190], [0.15, 255, 211, 111],
    [0.34, 255, 179, 44], [0.55, 255, 123, 22],
    [0.73, 234, 70, 20], [0.87, 175, 38, 17],
    [1, 77, 13, 12]
  ];
  const sunsetColors = new Uint8Array(4096 * 3);
  for (let sample = 0, stop = 0; sample < 4096; sample += 1) {
    const density = sample / 4095;
    while (stop < sunsetStops.length - 2 && density > sunsetStops[stop + 1][0]) stop += 1;
    const a = sunsetStops[stop], b = sunsetStops[stop + 1];
    const t = (density - a[0]) / (b[0] - a[0]);
    for (let channel = 1; channel <= 3; channel += 1) {
      sunsetColors[sample * 3 + channel - 1] = Math.round(a[channel] + (b[channel] - a[channel]) * t);
    }
  }

type Tool = "sand" | "shape" | "light";
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("sand"),
    [size, setSize] = useState(48),
    [started, setStarted] = useState(false),
    [paused, setPaused] = useState(false),
    [hint, setHint] = useState("触摸屏幕或移动光标，沙粒立即落下");
  const toolRef = useRef<Tool>(tool),
    sizeRef = useRef(size),
    pausedRef = useRef(false);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  useEffect(() => {
    const canvas = canvasRef.current!,
      ctx = canvas.getContext("2d", { alpha: false })!,
      buffer = document.createElement("canvas"),
      bctx = buffer.getContext("2d")!;
    let w = 0,
      h = 0,
      cols = 0,
      rows = 0,
      field = new Float32Array(0),
      noise = new Float32Array(0),
      image: ImageData,
      raf = 0,
      last = performance.now(),
      pointer = false,
      px = 0,
      py = 0,
      lx = 0,
      ly = 0,
      lastMoveAt = 0,
      lastEventAt = 0,
      hoverMode = false,
      hoverUntil = 0;
    const history: Float32Array[] = [];
    const setup = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      const quality = 2;
      cols = Math.ceil(w / quality);
      rows = Math.ceil(h / quality);
      const old = field,
        oc = buffer.width,
        or = buffer.height;
      buffer.width = cols;
      buffer.height = rows;
      field = new Float32Array(cols * rows);
      noise = new Float32Array(cols * rows);
      for (let i = 0; i < noise.length; i++) noise[i] = Math.random();
      if (old.length && oc && or)
        for (let y = 0; y < rows; y++)
          for (let x = 0; x < cols; x++)
            field[y * cols + x] =
              old[
                Math.min(or - 1, Math.floor((y / rows) * or)) * oc +
                  Math.min(oc - 1, Math.floor((x / cols) * oc))
              ];
      image = bctx.createImageData(cols, rows);
      canvas.width = w * (devicePixelRatio > 1 ? 1.5 : 1);
      canvas.height = h * (devicePixelRatio > 1 ? 1.5 : 1);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    };
    const stamp = (sx: number, sy: number, r: number, amount: number) => {
      const gx = (sx / w) * cols,
        gy = (sy / h) * rows,
        gr = (r / w) * cols;
      for (
        let y = Math.max(1, Math.floor(gy - gr));
        y < Math.min(rows - 1, Math.ceil(gy + gr));
        y++
      )
        for (
          let x = Math.max(1, Math.floor(gx - gr));
          x < Math.min(cols - 1, Math.ceil(gx + gr));
          x++
        ) {
          const d = Math.hypot(x - gx, y - gy) / gr;
          if (d < 1) {
            const fall = Math.pow(1 - d, 1.7),
              i = y * cols + x;
            field[i] = Math.max(
              0,
              Math.min(
                1.45,
                field[i] + amount * fall * (0.72 + noise[i] * 0.55),
              ),
            );
          }
        }
    };
    const paint = (x0: number, y0: number, x1: number, y1: number, r: number, speed: number) => {
      const dist = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
      const steps = Math.max(1, Math.ceil(dist / Math.max(2, r * 0.12)));
      const amount = 0.0022 + Math.max(0, 1 - speed / 1.25) * 0.005;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        stamp(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, amount);
      }
    };
    const push = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      r: number,
      erase = false,
    ) => {
      const dx = x1 - x0,
        dy = y1 - y0,
        dist = Math.max(1, Math.hypot(dx, dy)),
        steps = Math.max(1, Math.ceil(dist / 3));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps,
          cx = x0 + dx * t,
          cy = y0 + dy * t,
          gx = (cx / w) * cols,
          gy = (cy / h) * rows,
          gr = (r / w) * cols,
          nx = dx / dist,
          ny = dy / dist;
        for (
          let y = Math.max(1, Math.floor(gy - gr));
          y < Math.min(rows - 1, Math.ceil(gy + gr));
          y++
        )
          for (
            let x = Math.max(1, Math.floor(gx - gr));
            x < Math.min(cols - 1, Math.ceil(gx + gr));
            x++
          ) {
            const d = Math.hypot(x - gx, y - gy) / gr;
            if (d < 1) {
              const i = y * cols + x,
                take = field[i] * (erase ? 0.16 : 0.1) * Math.pow(1 - d, 1.4);
              field[i] -= take;
              if (!erase) {
                const side = (x - gx) * -ny + (y - gy) * nx,
                  ex = Math.round(
                    x +
                      nx * gr * 0.78 +
                      -ny * (side > 0 ? gr * 0.26 : -gr * 0.26),
                  ),
                  ey = Math.round(
                    y +
                      ny * gr * 0.78 +
                      nx * (side > 0 ? gr * 0.26 : -gr * 0.26),
                  );
                if (ex > 0 && ex < cols - 1 && ey > 0 && ey < rows - 1)
                  field[ey * cols + ex] = Math.min(
                    1.45,
                    field[ey * cols + ex] + take * 0.92,
                  );
              }
            }
          }
      }
    };
    const render = () => {
      const data = image.data;
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x,
            k = i * 4,
            raw = field[i],
            v = raw < 0.28 && noise[i] > raw * 3.65 ? 0 : raw,
            left = field[i - (x > 0 ? 1 : 0)],
            right = field[i + (x < cols - 1 ? 1 : 0)],
            up = field[i - (y > 0 ? cols : 0)],
            down = field[i + (y < rows - 1 ? cols : 0)],
            slope = (left - right) * 0.33 + (up - down) * 0.18,
            n = noise[i] - 0.5,
            impurity = v > 0.035 && Math.sin(i * 91.137) > 0.94 ? 30 : 0,
            absorb = 1 - Math.exp(-v * 5.1),
            grain = Math.min(1, v * 5.2) * n * 34,
            edge = Math.min(28, Math.abs(slope) * 145);
          const color = Math.round(absorb * 4095) * 3;
          data[k] = sunsetColors[color] + slope * 90 + grain * 0.65 + edge - impurity * 0.6;
          data[k + 1] = sunsetColors[color + 1] + slope * 52 + grain * 0.48 + edge * 0.5 - impurity * 0.4;
          data[k + 2] = sunsetColors[color + 2] + slope * 22 + grain * 0.25 + edge * 0.24 - impurity * 0.15;
          data[k + 3] = 255;
        }
      bctx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buffer, 0, 0, w, h);
      const glow = ctx.createRadialGradient(
        w * 0.5,
        h * 0.48,
        20,
        w * 0.5,
        h * 0.48,
        Math.max(w, h) * 0.72,
      );
      glow.addColorStop(0, "rgba(255,208,98,.035)");
      glow.addColorStop(1, "rgba(160,38,12,.07)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    };
    const loop = (now: number) => {
      const dt = Math.min(40, now - last);
      last = now;
      if (hoverMode && now > hoverUntil) pointer = false;
      if (pointer && !pausedRef.current) {
        const stillFor = now - lastMoveAt;
        const stationary = stillFor > 420;
        if (toolRef.current === "sand" && stationary) {
          const build = Math.min(1, (stillFor - 420) / 2800);
          stamp(
            px,
            py,
            sizeRef.current * (1 + build * 0.52),
            dt * (0.000045 + build * 0.00016),
          );
          if (stillFor > 900) setHint("持续停留 · 沙层正在缓慢加深");
        } else if (toolRef.current === "light" && stationary)
          stamp(px, py, sizeRef.current, -dt * 0.00045);
      }
      render();
      raf = requestAnimationFrame(loop);
    };
    const point = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      },
      down = (e: PointerEvent) => {
        e.preventDefault();
        if (pausedRef.current) return;
        canvas.setPointerCapture(e.pointerId);
        const p = point(e);
        px = lx = p.x;
        py = ly = p.y;
        pointer = true;
        hoverMode = false;
        lastMoveAt = lastEventAt = performance.now();
        if (toolRef.current === "sand") stamp(px, py, sizeRef.current, 0.0045);
        history.push(field.slice());
        if (history.length > 12) history.shift();
        setStarted(true);
        setHint(
          toolRef.current === "sand"
            ? "保持手指不动，沙粒会持续堆积"
            : "拖动手指塑造沙面",
        );
      },
      move = (e: PointerEvent) => {
        e.preventDefault();
        if (pausedRef.current) return;
        const p = point(e);
        const eventNow = performance.now();
        if (!pointer) {
          if (e.pointerType !== "mouse") return;
          px = lx = p.x;
          py = ly = p.y;
          pointer = true;
          hoverMode = true;
          lastMoveAt = lastEventAt = eventNow;
          hoverUntil = eventNow + 760;
          setStarted(true);
          return;
        }
        lx = px;
        ly = py;
        px = p.x;
        py = p.y;
        const now = eventNow;
        if (e.pointerType === "mouse" && hoverMode) hoverUntil = now + 760;
        const distance = Math.hypot(px - lx, py - ly);
        if (distance > 0.7) {
          const speed = distance / Math.max(4, now - lastEventAt);
          lastMoveAt = now;
          lastEventAt = now;
          if (toolRef.current === "sand") {
            paint(lx, ly, px, py, sizeRef.current, speed);
            setHint(speed > 0.8 ? "轻轻划过 · 留下薄而稀疏的沙层" : "缓慢移动 · 沙层会铺得更厚");
          } else if (toolRef.current === "shape") {
            push(lx, ly, px, py, sizeRef.current, false);
            setHint("慢慢推移沙粒，边缘会形成自然的沙脊");
          } else push(lx, ly, px, py, sizeRef.current, true);
        }
      },
      up = (e: PointerEvent) => {
        pointer = false;
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {}
      };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", () => { pointer = false; hoverMode = false; });
    window.addEventListener("resize", setup);
    setup();
    raf = requestAnimationFrame(loop);
    (
      window as unknown as {
        sandActions?: { clear: () => void; undo: () => void; save: () => void };
      }
    ).sandActions = {
      clear: () => {
        history.push(field.slice());
        field.fill(0);
        setStarted(false);
        setHint("触摸屏幕或移动光标，沙粒立即落下");
      },
      undo: () => {
        const prev = history.pop();
        if (prev && prev.length === field.length) {
          field.set(prev);
          setStarted(field.some((v) => v > 0.01));
        }
      },
      save: () => {
        const a = document.createElement("a");
        a.download = `manana-sunset-${Date.now()}.png`;
        a.href = canvas.toDataURL("image/png");
        a.click();
      },
    };
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", setup);
    };
  }, []);
  const action = (name: "clear" | "undo" | "save") =>
    (
      window as unknown as {
        sandActions: { clear: () => void; undo: () => void; save: () => void };
      }
    ).sandActions?.[name]();
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && ["z", "x", "s"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        action(e.key.toLowerCase() === "z" ? "undo" : e.key.toLowerCase() === "x" ? "clear" : "save");
        return;
      }
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      if (key === "a") { setTool("sand"); setHint("落砂模式 · 长按添加沙粒"); }
      if (key === "s") { setTool("shape"); setHint("塑形模式 · 推移并堆积已有沙粒"); }
      if (key === "d") { setTool("light"); setHint("透光模式 · 擦去沙粒露出灯板"); }
      if (key === "f") {
        setPaused((current) => {
          const next = !current;
          pausedRef.current = next;
          setHint(next ? "已暂停 · 所有触摸操作已冻结 · 按 F 恢复" : "已恢复 · 触摸或移动光标继续创作");
          return next;
        });
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
  return (
    <main className="sand-app">
      <canvas ref={canvasRef} aria-label="可触摸创作的沙画灯箱" />
      <header>
        <div>
          <span className="brand-dot" />
          <b>MAÑANA</b>
          <small>落日沙画画台</small>
        </div>
        <p>{hint}</p>
      </header>
      {!started && (
        <section className="welcome">
          <span>01 / ADD SAND</span>
          <h1>
            <span data-text="触摸光，">触摸光，</span>
            <br />
            <span data-text="让沙落下。">让沙落下。</span>
          </h1>
          <p>
            用一根手指在画面中停留，沙粒会从指尖逐渐堆积。
            <br />
            移动手指，将沙塑造成你想象中的画面。
          </p>
          <i>触摸屏幕或移动光标开始</i>
        </section>
      )}
      <nav aria-label="沙画快捷操作栏">
        <button
          className={tool === "sand" ? "active" : ""}
          onClick={() => {
            setTool("sand");
            setHint("长按添加沙粒，移动手指同时塑形");
          }}
        >
          <kbd>A</kbd><em>落砂</em>
        </button>
        <button
          className={tool === "shape" ? "active" : ""}
          onClick={() => {
            setTool("shape");
            setHint("拖动手指，推移并堆积已有沙粒");
          }}
        >
          <kbd>S</kbd><em>塑形</em>
        </button>
        <button
          className={tool === "light" ? "active" : ""}
          onClick={() => {
            setTool("light");
            setHint("擦去沙层，重新露出温暖的灯光");
          }}
        >
          <kbd>D</kbd><em>透光</em>
        </button>
        <div className="divider" />
        <button className={paused ? "pause active" : "pause"} onClick={() => { const next = !paused; pausedRef.current = next; setPaused(next); setHint(next ? "已暂停 · 所有触摸操作已冻结 · 按 F 恢复" : "已恢复 · 触摸或移动光标继续创作"); }}>
          <kbd>F</kbd><em>{paused ? "恢復" : "暫停"}</em>
        </button>
        <button onClick={() => action("undo")}>
          <kbd>⌘ Z</kbd><em>撤回</em>
        </button>
        <button onClick={() => action("clear")}>
          <kbd>⌘ X</kbd><em>清空</em>
        </button>
        <button onClick={() => action("save")}>
          <kbd>⌘ S</kbd><em>保存</em>
        </button>
        <label className="brush-control"><em>笔触大小</em><input aria-label="笔触大小" type="range" min="8" max="200" value={size} onChange={(e) => setSize(+e.target.value)} /><output>{size}</output></label>
      </nav>
      <aside>按住落砂　·　移动塑形　·　薄沙散点　·　厚沙深金</aside>
    </main>
  );
}
