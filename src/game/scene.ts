import type { Boss, SilhouetteKind } from "./bosses";

/** Canvas 2D renderer. Knows nothing about rules, only how to draw a frame. */

export interface Layout {
  w: number;
  h: number;
  cx: number;
  /** Guard line y. */
  gy: number;
  /** Blade pivot (the boss's hand). */
  px: number;
  py: number;
  /** Blade length. */
  len: number;
  /** Angle (radians, clockwise from up) at which the tip meets the guard line. */
  impactAngle: number;
}

/**
 * Geometry is solved so the blade tip lands exactly on the centre of the
 * guard line at `impactAngle`. Impact is that frame.
 */
export function computeLayout(w: number, h: number): Layout {
  const gy = h * 0.8;
  const px = w * 0.06;
  const len = w * 0.86;
  const impactAngle = Math.PI - Math.asin((w * 0.5 - px) / len);
  const py = gy + len * Math.cos(impactAngle);
  return { w, h, cx: w / 2, gy, px, py, len, impactAngle };
}

export interface FrameState {
  now: number;
  /** Blade angle in radians, clockwise from up. */
  angle: number;
  /** Earlier blade angle for the motion trail, or null for none. */
  trailFrom: number | null;
  /** 0..1 boss presence (fades in during the intro). */
  presence: number;
  /** 0..1 extra eye intensity. */
  menace: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
}

interface Flash {
  rgb: string;
  alpha: number;
  start: number;
  dur: number;
}

const GOLD = "212,175,55";

export class Scene {
  private particles: Particle[] = [];
  private flash: Flash | null = null;
  private ring: { start: number; dur: number } | null = null;
  private shake: { start: number; dur: number; mag: number } | null = null;
  private guardPulse = -1e9;
  private fog: HTMLCanvasElement;
  private lastNow = 0;

  constructor(
    private boss: Boss,
    private reducedMotion: boolean,
  ) {
    this.fog = document.createElement("canvas");
    this.fog.width = this.fog.height = 128;
    const g = this.fog.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(160,155,180,1)");
    grad.addColorStop(0.5, "rgba(140,135,160,0.45)");
    grad.addColorStop(1, "rgba(120,115,140,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }

  /** Clean deflect: big burst, ring, shake. */
  perfect(now: number, l: Layout): void {
    this.burst(now, l, 46, 1);
    this.ring = { start: now, dur: 420 };
    this.flash = { rgb: "255,225,150", alpha: 0.16, start: now, dur: 260 };
    this.guardPulse = now;
    if (!this.reducedMotion) this.shake = { start: now, dur: 260, mag: l.w * 0.018 };
  }

  /** Decent hit: smaller spark. */
  hit(now: number, l: Layout, quality: number): void {
    this.burst(now, l, Math.round(5 + 15 * quality), 0.45 + 0.35 * quality);
    this.guardPulse = now;
  }

  /** Unanswered blow: dull red flash. */
  miss(now: number): void {
    this.flash = { rgb: "120,14,14", alpha: 0.42, start: now, dur: 520 };
  }

  private burst(now: number, l: Layout, count: number, power: number): void {
    for (let i = 0; i < count; i++) {
      // Mostly upward fan from the point of contact.
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25;
      const speed = l.w * (0.5 + Math.random() * 1.9) * power;
      this.particles.push({
        x: l.cx,
        y: l.gy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        born: now,
        life: 320 + Math.random() * 520 * power,
        size: 1 + Math.random() * 1.8,
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D, l: Layout, s: FrameState): void {
    const { w, h, cx } = l;
    const now = s.now;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const drift = this.reducedMotion ? 0 : now / 1000;

    ctx.save();
    if (this.shake) {
      const u = (now - this.shake.start) / this.shake.dur;
      if (u >= 1) this.shake = null;
      else {
        const m = this.shake.mag * (1 - u);
        ctx.translate((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * 2 * m);
      }
    }

    // Backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#08070b");
    bg.addColorStop(0.6, "#0b090e");
    bg.addColorStop(1, "#0d0908");
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, w + 40, h + 40);

    const headY = l.py - w * 0.55;
    const halo = ctx.createRadialGradient(cx, headY + w * 0.1, 0, cx, headY + w * 0.1, w * 0.95);
    halo.addColorStop(0, `rgba(96,70,58,${0.34 * s.presence})`);
    halo.addColorStop(0.5, `rgba(52,40,48,${0.2 * s.presence})`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    this.drawFog(ctx, l, drift, BACK_FOG, 0.6 + 0.4 * s.presence);

    // Boss
    ctx.globalAlpha = 0.25 + 0.75 * s.presence;
    drawSilhouette(ctx, this.boss.look.kind, l, headY);
    ctx.globalAlpha = 1;
    drawEyes(ctx, this.boss, l, headY, s.presence, s.menace, drift);

    this.drawFog(ctx, l, drift, FRONT_FOG, 1);
    if (!this.reducedMotion) drawEmbers(ctx, l, drift);

    this.drawGuard(ctx, l, now);
    if (s.trailFrom !== null && !this.reducedMotion) drawTrail(ctx, l, s.trailFrom, s.angle);
    drawBlade(ctx, l, s.angle);

    // Ring
    if (this.ring) {
      const u = (now - this.ring.start) / this.ring.dur;
      if (u >= 1) this.ring = null;
      else {
        ctx.strokeStyle = `rgba(255,226,150,${0.8 * (1 - u)})`;
        ctx.lineWidth = 3 * (1 - u) + 0.5;
        ctx.beginPath();
        ctx.arc(cx, l.gy, w * (0.04 + 0.34 * (1 - Math.pow(1 - u, 3))), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Sparks
    if (this.particles.length) {
      ctx.lineCap = "round";
      this.particles = this.particles.filter((p) => now - p.born < p.life);
      for (const p of this.particles) {
        p.vy += h * 1.6 * dt;
        p.vx *= 1 - 1.2 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const a = 1 - (now - p.born) / p.life;
        ctx.strokeStyle = `rgba(255,${200 + Math.round(40 * a)},${110 + Math.round(90 * a)},${a})`;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.028, p.y - p.vy * 0.028);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Full-screen flash and vignette (not shaken)
    if (this.flash) {
      const u = (now - this.flash.start) / this.flash.dur;
      if (u >= 1) this.flash = null;
      else {
        ctx.fillStyle = `rgba(${this.flash.rgb},${this.flash.alpha * (1 - u) * (1 - u)})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
    const vig = ctx.createRadialGradient(cx, h * 0.5, h * 0.25, cx, h * 0.5, h * 0.78);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  private drawFog(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    t: number,
    blobs: readonly FogBlob[],
    strength: number,
  ): void {
    for (const b of blobs) {
      const size = l.w * b.size;
      const span = l.w + size;
      const x = ((((b.phase * span + t * b.speed * l.w) % span) + span) % span) - size;
      const y = l.h * b.y - size * 0.3 + Math.sin(t * 0.13 + b.phase * 9) * l.h * 0.012;
      ctx.globalAlpha = b.alpha * strength;
      ctx.drawImage(this.fog, x, y, size, size * 0.6);
    }
    ctx.globalAlpha = 1;
  }

  private drawGuard(ctx: CanvasRenderingContext2D, l: Layout, now: number): void {
    const pulse = Math.max(0, 1 - (now - this.guardPulse) / 380);
    const x0 = l.w * 0.13;
    const x1 = l.w * 0.87;
    const grad = ctx.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, `rgba(${GOLD},0)`);
    grad.addColorStop(0.18, `rgba(${GOLD},${0.75 + 0.25 * pulse})`);
    grad.addColorStop(0.5, `rgba(255,${222 + 20 * pulse},${150 + 60 * pulse},1)`);
    grad.addColorStop(0.82, `rgba(${GOLD},${0.75 + 0.25 * pulse})`);
    grad.addColorStop(1, `rgba(${GOLD},0)`);
    ctx.save();
    ctx.shadowColor = `rgba(255,200,90,${0.7 + 0.3 * pulse})`;
    ctx.shadowBlur = 10 + 26 * pulse;
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2 + 2.5 * pulse;
    ctx.beginPath();
    ctx.moveTo(x0, l.gy);
    ctx.lineTo(x1, l.gy);
    ctx.stroke();
    // Centre diamond marks the exact point of contact.
    const d = l.w * 0.014 * (1 + 0.6 * pulse);
    ctx.fillStyle = "rgba(255,232,170,1)";
    ctx.beginPath();
    ctx.moveTo(l.cx, l.gy - d);
    ctx.lineTo(l.cx + d, l.gy);
    ctx.lineTo(l.cx, l.gy + d);
    ctx.lineTo(l.cx - d, l.gy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

interface FogBlob {
  y: number;
  size: number;
  speed: number;
  alpha: number;
  phase: number;
}

const BACK_FOG: readonly FogBlob[] = [
  { y: 0.2, size: 1.9, speed: 0.012, alpha: 0.2, phase: 0.1 },
  { y: 0.34, size: 2.2, speed: -0.009, alpha: 0.17, phase: 0.55 },
  { y: 0.5, size: 1.7, speed: 0.016, alpha: 0.14, phase: 0.8 },
];

const FRONT_FOG: readonly FogBlob[] = [
  { y: 0.62, size: 1.8, speed: -0.02, alpha: 0.1, phase: 0.3 },
  { y: 0.86, size: 2.3, speed: 0.026, alpha: 0.2, phase: 0.05 },
  { y: 0.95, size: 2.0, speed: -0.032, alpha: 0.24, phase: 0.62 },
  { y: 1.02, size: 2.6, speed: 0.018, alpha: 0.22, phase: 0.9 },
];

function drawEmbers(ctx: CanvasRenderingContext2D, l: Layout, t: number): void {
  for (let i = 0; i < 12; i++) {
    const seed = i * 12.9898;
    const period = 9 + (i % 5) * 2.3;
    const u = (t / period + (Math.sin(seed) * 0.5 + 0.5)) % 1;
    const x = l.w * ((Math.sin(seed * 3.7) * 0.5 + 0.5) + Math.sin(t * 0.4 + i) * 0.02);
    const y = l.h * (1.02 - u * 0.75);
    const a = Math.sin(u * Math.PI) * 0.55;
    ctx.fillStyle = `rgba(255,${130 + (i % 3) * 30},60,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + (i % 3) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function spike(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  len: number,
  width: number,
): void {
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  ctx.beginPath();
  ctx.moveTo(x - dy * width, y + dx * width);
  ctx.lineTo(x + dx * len, y + dy * len);
  ctx.lineTo(x + dy * width, y - dx * width);
  ctx.closePath();
  ctx.fill();
}

const SHOULDER_SCALE: Record<SilhouetteKind, number> = {
  keeper: 1,
  knight: 1.05,
  warden: 0.86,
  twins: 1.12,
  caller: 0.94,
  mother: 1.3,
  king: 1.1,
};

const deg = (d: number) => (d * Math.PI) / 180;

function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  kind: SilhouetteKind,
  l: Layout,
  hy: number,
): void {
  const { cx, h } = l;
  const u = l.w;
  const k = SHOULDER_SCALE[kind];
  const sy = hy + 0.17 * u;
  ctx.fillStyle = "#030204";
  ctx.strokeStyle = "#030204";

  // Torso and shoulders, running off the bottom of the screen.
  ctx.beginPath();
  ctx.moveTo(cx - 0.78 * u * k, h + 10);
  ctx.bezierCurveTo(cx - 0.62 * u * k, sy + 0.5 * u, cx - 0.52 * u * k, sy + 0.07 * u, cx - 0.3 * u * k, sy);
  ctx.quadraticCurveTo(cx - 0.12 * u, sy - 0.03 * u, cx - 0.085 * u, sy - 0.08 * u);
  ctx.lineTo(cx + 0.085 * u, sy - 0.08 * u);
  ctx.quadraticCurveTo(cx + 0.12 * u, sy - 0.03 * u, cx + 0.3 * u * k, sy);
  ctx.bezierCurveTo(cx + 0.52 * u * k, sy + 0.07 * u, cx + 0.62 * u * k, sy + 0.5 * u, cx + 0.78 * u * k, h + 10);
  ctx.closePath();
  ctx.fill();

  // Arm reaching to the blade hand.
  ctx.lineCap = "round";
  ctx.lineWidth = 0.12 * u;
  ctx.beginPath();
  ctx.moveTo(cx - 0.3 * u * k, sy + 0.07 * u);
  ctx.quadraticCurveTo(l.px + 0.02 * u, sy + 0.08 * u, l.px, l.py);
  ctx.stroke();

  const head = (x: number, y: number, rx: number, ry: number) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx * u, ry * u, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  switch (kind) {
    case "keeper": {
      head(cx, hy, 0.1, 0.125);
      ctx.beginPath();
      ctx.moveTo(cx - 0.2 * u, sy + 0.04 * u);
      ctx.bezierCurveTo(cx - 0.21 * u, hy - 0.05 * u, cx - 0.1 * u, hy - 0.21 * u, cx + 0.03 * u, hy - 0.25 * u);
      ctx.bezierCurveTo(cx + 0.12 * u, hy - 0.17 * u, cx + 0.21 * u, hy - 0.03 * u, cx + 0.2 * u, sy + 0.04 * u);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "knight": {
      head(cx, hy, 0.1, 0.125);
      const top = hy - 0.1 * u;
      for (const [a, len] of [[-58, 0.13], [-28, 0.19], [0, 0.11], [28, 0.19], [58, 0.13]] as const) {
        spike(ctx, cx + Math.sin(deg(a)) * 0.07 * u, top + (1 - Math.cos(deg(a))) * 0.06 * u, deg(a), len * u, 0.022 * u);
      }
      for (const side of [-1, 1]) {
        for (const [off, a, len] of [[0.2, 18, 0.13], [0.3, 34, 0.17], [0.4, 52, 0.12]] as const) {
          spike(ctx, cx + side * off * u * k, sy + 0.03 * u, deg(a * side), len * u, 0.025 * u);
        }
      }
      break;
    }
    case "warden": {
      head(cx, hy, 0.085, 0.14);
      spike(ctx, cx, hy - 0.1 * u, 0, 0.3 * u, 0.03 * u);
      for (const side of [-1, 1]) {
        spike(ctx, cx + side * 0.13 * u, sy + 0.02 * u, deg(side * 8), 0.24 * u, 0.06 * u);
      }
      break;
    }
    case "twins": {
      head(cx - 0.15 * u, hy + 0.02 * u, 0.085, 0.11);
      head(cx + 0.15 * u, hy - 0.03 * u, 0.085, 0.11);
      ctx.lineWidth = 0.1 * u;
      for (const [x, y] of [[-0.15, 0.02], [0.15, -0.03]] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + x * u, hy + y * u);
        ctx.lineTo(cx + x * 0.6 * u, sy + 0.04 * u);
        ctx.stroke();
      }
      spike(ctx, cx - 0.15 * u, hy - 0.07 * u, deg(-6), 0.12 * u, 0.05 * u);
      spike(ctx, cx + 0.15 * u, hy - 0.12 * u, deg(6), 0.12 * u, 0.05 * u);
      break;
    }
    case "caller": {
      head(cx, hy, 0.095, 0.125);
      head(cx, hy - 0.075 * u, 0.26, 0.032);
      ctx.beginPath();
      ctx.moveTo(cx - 0.1 * u, hy - 0.07 * u);
      ctx.lineTo(cx - 0.075 * u, hy - 0.28 * u);
      ctx.lineTo(cx + 0.075 * u, hy - 0.26 * u);
      ctx.lineTo(cx + 0.1 * u, hy - 0.07 * u);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "mother": {
      head(cx, sy - 0.02 * u, 0.44, 0.17);
      head(cx, hy + 0.05 * u, 0.085, 0.105);
      for (const a of [-64, -40, -18, 18, 40, 64]) {
        const r = deg(a);
        spike(ctx, cx + Math.sin(r) * 0.3 * u, sy - 0.03 * u - Math.cos(r) * 0.12 * u, r * 0.75, 0.24 * u, 0.028 * u);
      }
      break;
    }
    case "king": {
      head(cx, hy, 0.1, 0.13);
      const lens = [0.15, 0.07, 0.21, 0.1, 0.16];
      lens.forEach((len, i) => {
        const x = cx + (i - 2) * 0.042 * u;
        spike(ctx, x, hy - 0.09 * u, deg((i - 2) * 7), len * u, 0.024 * u);
      });
      for (const side of [-1, 1]) {
        spike(ctx, cx + side * 0.34 * u * k, sy + 0.04 * u, deg(side * 62), 0.2 * u, 0.06 * u);
      }
      break;
    }
  }
}

function eyePositions(kind: SilhouetteKind, l: Layout, hy: number): Array<[number, number]> {
  const u = l.w;
  const { cx } = l;
  const pair = (x: number, y: number, gap = 0.042): Array<[number, number]> => [
    [x - gap * u, y],
    [x + gap * u, y],
  ];
  switch (kind) {
    case "twins":
      return [...pair(cx - 0.15 * u, hy + 0.02 * u, 0.034), ...pair(cx + 0.15 * u, hy - 0.03 * u, 0.034)];
    case "mother":
      return pair(cx, hy + 0.05 * u, 0.034);
    case "warden":
      return pair(cx, hy - 0.01 * u, 0.036);
    default:
      return pair(cx, hy + 0.005 * u);
  }
}

function drawEyes(
  ctx: CanvasRenderingContext2D,
  boss: Boss,
  l: Layout,
  hy: number,
  presence: number,
  menace: number,
  t: number,
): void {
  if (presence <= 0.02) return;
  const [r, g, b] = boss.look.eye;
  const u = l.w;
  const flicker = 0.88 + 0.12 * Math.sin(t * 2.3) * Math.sin(t * 0.7);
  const a = Math.min(1, presence * presence * flicker * (0.8 + 0.2 * menace));
  ctx.save();
  ctx.shadowColor = `rgba(${r},${g},${b},${a})`;
  ctx.shadowBlur = u * (0.035 + 0.03 * menace);
  ctx.fillStyle = `rgba(${Math.min(255, r + 30)},${Math.min(255, g + 30)},${Math.min(255, b + 30)},${a})`;
  for (const [x, y] of eyePositions(boss.look.kind, l, hy)) {
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      ctx.ellipse(x, y, u * 0.013, u * (0.007 + 0.002 * menace), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawTrail(ctx: CanvasRenderingContext2D, l: Layout, from: number, to: number): void {
  if (to - from < 0.02) return;
  // Canvas arcs measure from +x; our angles measure clockwise from up.
  const a0 = from - Math.PI / 2;
  const a1 = to - Math.PI / 2;
  ctx.fillStyle = "rgba(230,214,180,0.09)";
  ctx.beginPath();
  ctx.arc(l.px, l.py, l.len, a0, a1);
  ctx.arc(l.px, l.py, l.len * 0.3, a1, a0, true);
  ctx.closePath();
  ctx.fill();
}

function drawBlade(ctx: CanvasRenderingContext2D, l: Layout, angle: number): void {
  const { len, w } = l;
  const bw = w * 0.022;
  ctx.save();
  ctx.translate(l.px, l.py);
  ctx.rotate(angle);
  // Blade points "up" in local space.
  const steel = ctx.createLinearGradient(-bw, 0, bw, 0);
  steel.addColorStop(0, "#15141a");
  steel.addColorStop(0.45, "#34323b");
  steel.addColorStop(1, "#77737c");
  ctx.fillStyle = steel;
  ctx.beginPath();
  ctx.moveTo(-bw, -len * 0.06);
  ctx.lineTo(-bw * 0.8, -len * 0.9);
  ctx.lineTo(0, -len);
  ctx.lineTo(bw * 0.8, -len * 0.9);
  ctx.lineTo(bw, -len * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(226,214,190,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bw, -len * 0.06);
  ctx.lineTo(bw * 0.8, -len * 0.9);
  ctx.lineTo(0, -len);
  ctx.stroke();
  // Crossguard, grip, fist
  ctx.fillStyle = "#0c0a0d";
  ctx.fillRect(-w * 0.055, -len * 0.075, w * 0.11, len * 0.022);
  ctx.fillRect(-bw * 0.6, -len * 0.06, bw * 1.2, len * 0.13);
  ctx.fillStyle = "#030204";
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
