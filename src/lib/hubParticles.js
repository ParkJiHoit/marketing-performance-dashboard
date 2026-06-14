/**
 * Hub Launcher Particle System
 * AntiGravity physics — spring return + mouse repulsion + elastic collisions
 * Adapts colors for light / dark theme automatically.
 */
(function () {
  "use strict";

  const PARTICLE_DENSITY   = 0.000085;
  const BG_DENSITY         = 0.000032;
  const MOUSE_RADIUS       = 160;
  const RETURN_SPEED       = 0.072;
  const DAMPING            = 0.88;
  const REPULSION_STRENGTH = 1.1;

  // ── Theme-aware color palettes ─────────────────────────────────────────────
  const PALETTES = {
    light: {
      glowR: 255, glowG: 90, glowB: 95, glowOpacityBase: 0.06, glowOpacityAmp: 0.025,
      dotDefault: "rgba(25,31,40,0.45)",
      dotAccent:  "#ff5a5f",
      dotBlue:    "rgba(49,130,246,0.7)",
      starColor:  "rgba(100,115,135,0.22)",
    },
    dark: {
      glowR: 255, glowG: 125, glowB: 130, glowOpacityBase: 0.07, glowOpacityAmp: 0.03,
      dotDefault: "rgba(242,244,246,0.55)",
      dotAccent:  "#ff7d82",
      dotBlue:    "rgba(69,147,255,0.75)",
      starColor:  "rgba(220,230,245,0.18)",
    },
  };

  let palette = PALETTES.light;

  // ── State ──────────────────────────────────────────────────────────────────
  let canvas, ctx, container;
  let particles = [], bgParticles = [];
  let mouse = { x: -1000, y: -1000, active: false };
  let frameId = 0;
  let lastTime = 0;
  let dpr = 1;
  let cssW = 0, cssH = 0;

  function rand(min, max) { return Math.random() * (max - min) + min; }

  // ── Particle factories ─────────────────────────────────────────────────────
  function makeParticle(w, h) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const roll = Math.random();
    const color = roll > 0.92 ? "accent" : roll > 0.82 ? "blue" : "default";
    return { x, y, originX: x, originY: y, vx: 0, vy: 0, size: rand(1.1, 2.6), color };
  }

  function makeBgParticle(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      size: rand(0.5, 1.4),
      alpha: rand(0.1, 0.35),
      phase: Math.random() * Math.PI * 2,
    };
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function initParticles(w, h) {
    const count = Math.floor(w * h * PARTICLE_DENSITY);
    particles = Array.from({ length: count }, () => makeParticle(w, h));

    const bgCount = Math.floor(w * h * BG_DENSITY);
    bgParticles = Array.from({ length: bgCount }, () => makeBgParticle(w, h));
  }

  function resize() {
    if (!container || !canvas) return;
    const rect = container.getBoundingClientRect();
    cssW = rect.width;
    cssH = rect.height;
    dpr = window.devicePixelRatio || 1;

    canvas.width  = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width  = cssW + "px";
    canvas.style.height = cssH + "px";

    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    initParticles(cssW, cssH);
  }

  // ── Animation loop ─────────────────────────────────────────────────────────
  function animate(time) {
    if (!ctx) { frameId = requestAnimationFrame(animate); return; }

    lastTime = time;
    ctx.clearRect(0, 0, cssW, cssH);

    // Pulsating radial glow
    const pulse = Math.sin(time * 0.0007) * palette.glowOpacityAmp + palette.glowOpacityBase;
    const cx = cssW / 2, cy = cssH / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(cssW, cssH) * 0.65);
    grad.addColorStop(0, `rgba(${palette.glowR},${palette.glowG},${palette.glowB},${pulse})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cssW, cssH);

    // Background drifting stars
    for (let i = 0; i < bgParticles.length; i++) {
      const p = bgParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = cssW;
      if (p.x > cssW) p.x = 0;
      if (p.y < 0) p.y = cssH;
      if (p.y > cssH) p.y = 0;

      const twinkle = Math.sin(time * 0.0018 + p.phase) * 0.5 + 0.5;
      ctx.globalAlpha = p.alpha * (0.3 + 0.7 * twinkle);
      ctx.fillStyle = palette.starColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Phase 1 – apply forces
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      if (mouse.active) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_RADIUS && dist > 0.5) {
          const force = ((MOUSE_RADIUS - dist) / MOUSE_RADIUS) * REPULSION_STRENGTH;
          p.vx -= (dx / dist) * force * 4.5;
          p.vy -= (dy / dist) * force * 4.5;
        }
      }

      p.vx += (p.originX - p.x) * RETURN_SPEED;
      p.vy += (p.originY - p.y) * RETURN_SPEED;
    }

    // Phase 2 – elastic collisions (O(n²) cheap for small n)
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        const minD = a.size + b.size;
        if (distSq < minD * minD) {
          const dist = Math.sqrt(distSq);
          if (dist < 0.01) continue;
          const nx = dx / dist, ny = dy / dist;
          const overlap = (minD - dist) * 0.5;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;
          const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
          const vNorm = dvx * nx + dvy * ny;
          if (vNorm > 0) {
            const imp = -(1 + 0.82) * vNorm / (1 / a.size + 1 / b.size);
            a.vx += imp * nx / a.size; a.vy += imp * ny / a.size;
            b.vx -= imp * nx / b.size; b.vy -= imp * ny / b.size;
          }
        }
      }
    }

    // Phase 3 – integrate & draw
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      p.x  += p.vx;
      p.y  += p.vy;

      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const alpha = Math.min(0.28 + speed * 0.09, 1);

      if (p.color === "accent") {
        ctx.fillStyle = palette.dotAccent;
        ctx.globalAlpha = Math.min(0.75 + speed * 0.06, 1);
      } else if (p.color === "blue") {
        ctx.fillStyle = palette.dotBlue;
        ctx.globalAlpha = Math.min(0.65 + speed * 0.07, 1);
      } else {
        ctx.fillStyle = palette.dotDefault;
        ctx.globalAlpha = alpha;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    frameId = requestAnimationFrame(animate);
  }

  // ── Mouse tracking ─────────────────────────────────────────────────────────
  function onMouseMove(e) {
    const rect = container.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    mouse.active = true;
  }

  function onMouseLeave() { mouse.active = false; }

  function onTouchMove(e) {
    const touch = e.touches[0];
    const rect = container.getBoundingClientRect();
    mouse.x = touch.clientX - rect.left;
    mouse.y = touch.clientY - rect.top;
    mouse.active = true;
  }

  function onTouchEnd() { mouse.active = false; }

  // ── Init internals ─────────────────────────────────────────────────────────
  function setup() {
    canvas    = document.getElementById("hubParticleCanvas");
    container = document.getElementById("hubLauncher");
    if (!canvas || !container) return;

    resize();

    container.addEventListener("mousemove",  onMouseMove);
    container.addEventListener("mouseleave", onMouseLeave);
    container.addEventListener("touchmove",  onTouchMove,  { passive: true });
    container.addEventListener("touchend",   onTouchEnd);

    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const stored = localStorage.getItem("marketing-dashboard-theme-v2") || "light";
    palette = PALETTES[stored] || PALETTES.light;

    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(animate);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.HubParticles = {
    init: setup,
    updateTheme(theme) {
      palette = PALETTES[theme] || PALETTES.light;
    },
  };

  // Auto-boot: defer guarantees DOM is ready when this script runs
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();
