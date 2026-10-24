"use client";

import { useEffect, useRef } from "react";

/**
 * Sephiroth star-field — a calm obsidian sky.
 * Subtle twinkling stars + one slow drifting "satellite" glint.
 * Respects prefers-reduced-motion (renders static stars).
 */
export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    interface Star {
      x: number;
      y: number;
      r: number;
      base: number;
      amp: number;
      phase: number;
      speed: number;
      vx: number;
      vy: number;
    }

    let stars: Star[] = [];

    const seed = () => {
      const count = Math.min(170, Math.floor((width * height) / 12000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.1 + 0.25,
        base: 0.18 + Math.random() * 0.3,
        amp: 0.1 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
        speed: 0.0004 + Math.random() * 0.0012,
        vx: (Math.random() - 0.5) * 0.012,
        vy: (Math.random() - 0.5) * 0.012,
      }));
    };

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      for (const s of stars) {
        if (!reduced) {
          s.x += s.vx;
          s.y += s.vy;
          if (s.x < 0) s.x = width;
          if (s.x > width) s.x = 0;
          if (s.y < 0) s.y = height;
          if (s.y > height) s.y = 0;
        }
        const alpha = reduced ? s.base : s.base + Math.sin(t * s.speed + s.phase) * s.amp;
        const a = Math.max(0.04, Math.min(0.75, alpha));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(210, 235, 245, ${a})`;
        ctx.fill();
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-70"
    />
  );
}
