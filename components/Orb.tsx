'use client';
// L'ORBE D'ALGORIA — son « cerveau » visible : une sphère de ~400 particules en rotation (canvas 2D,
// projection 3D maison, sphère de Fibonacci) qui RESPIRE selon l'état vocal, aux couleurs de la marque :
//   idle      → rotation lente, respiration douce (cyan/bleu)
//   listening → s'éveille : plus ample, plus lumineux
//   thinking  → tourbillonne vite (teinté d'or)
//   speaking  → pulse fort, tout en or métallique
// Zéro dépendance, ~0.3 ms/frame sur un canvas 120px — utilisable en mini (header) comme en grand (overlay).
import { useEffect, useRef } from 'react';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

const PARAMS: Record<OrbState, { speed: number; amp: number; glow: number; gold: number }> = {
  idle: { speed: 0.22, amp: 0.07, glow: 0.6, gold: 0 },
  listening: { speed: 0.55, amp: 0.22, glow: 1, gold: 0 },
  thinking: { speed: 1.5, amp: 0.14, glow: 0.95, gold: 0.55 },
  speaking: { speed: 0.6, amp: 0.34, glow: 1, gold: 1 },
};

const CYAN = [43, 227, 245] as const; // faces avant
const BLUE = [46, 100, 220] as const; // faces arrière (profondeur)
const GOLD = [245, 194, 74] as const;
const mix = (a: readonly number[], b: readonly number[], k: number) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

export function AlgoriaOrb({ size = 120, state = 'idle', dim = false }: { size?: number; state?: OrbState; dim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Sphère de Fibonacci : répartition uniforme des particules, phase propre à chacune (wobble organique)
    const N = size >= 80 ? 650 : 220;
    const pts: { x: number; y: number; z: number; ph: number }[] = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = ga * i;
      pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, ph: ((i * 37) % 100) / 100 * Math.PI * 2 });
    }

    const cur = { ...PARAMS[stateRef.current] };
    let rot = 0;
    let raf = 0;
    let last = performance.now();
    const t0 = last;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      // transitions d'état LISSÉES (l'orbe « s'éveille », il ne saute pas)
      const tg = PARAMS[stateRef.current];
      cur.speed += (tg.speed - cur.speed) * dt * 4;
      cur.amp += (tg.amp - cur.amp) * dt * 4;
      cur.glow += (tg.glow - cur.glow) * dt * 4;
      cur.gold += (tg.gold - cur.gold) * dt * 4;
      rot += cur.speed * dt;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.translate(size / 2, size / 2);
      const R = size * 0.34;
      const base = mix(CYAN, GOLD, cur.gold);

      // halo d'ambiance
      const g = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 1.6);
      g.addColorStop(0, `rgba(${base[0] | 0},${base[1] | 0},${base[2] | 0},${(0.14 * cur.glow).toFixed(3)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-size / 2, -size / 2, size, size);

      ctx.globalCompositeOperation = 'lighter'; // les particules s'additionnent → cœur lumineux
      const tilt = 0.45;
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const cy = Math.cos(rot);
      const sy = Math.sin(rot);
      const dotR = Math.max(0.4, size / 150);
      for (const p of pts) {
        // rotation Y puis inclinaison X
        const x = p.x * cy + p.z * sy;
        const z1 = -p.x * sy + p.z * cy;
        const y1 = p.y * ct - z1 * st;
        const z2 = p.y * st + z1 * ct;
        // respiration organique : ONDE spatiale cohérente (la surface se déforme, elle ne vibre pas en confettis)
        const wob = 1 + cur.amp * (0.55 * Math.sin(p.y * 3.2 + t * 2.1) + 0.35 * Math.sin(p.x * 2.6 + p.z * 1.8 + t * 1.5) + 0.1 * Math.sin(p.ph + t * 3.0));
        const persp = 1 / (1 + z2 * 0.38);
        const px = x * wob * R * persp;
        const py = y1 * wob * R * persp;
        const front = (1 - z2) / 2; // 1 = devant, 0 = derrière
        const c = mix(mix(BLUE, CYAN, front), GOLD, cur.gold);
        const a = (0.16 + 0.6 * front) * cur.glow;
        ctx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px, py, dotR * (0.55 + 0.8 * front) * persp, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} aria-hidden style={{ width: size, height: size, display: 'block', opacity: dim ? 0.45 : 1, transition: 'opacity .3s' }} />;
}
