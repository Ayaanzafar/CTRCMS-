"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMarquee } from "@/components/BrandMarquee";
import { SUNRACK_LOGO_DARK } from "@/constants/sunrack-partners";

/** Pixel ripple palette — dark hero (silver / zinc dots) */
const DARK_PIXEL_COLORS = [
  "rgba(161, 161, 170, 0.35)",
  "rgba(161, 161, 170, 0.25)",
  "rgba(228, 228, 231, 0.2)",
  "rgba(113, 113, 122, 0.3)",
  "rgba(255, 255, 255, 0.15)",
];

type Pixel = {
  x: number;
  y: number;
  color: string;
  ctx: CanvasRenderingContext2D;
  speed: number;
  size: number;
  sizeStep: number;
  minSize: number;
  maxSizeInt: number;
  maxSize: number;
  delay: number;
  counter: number;
  counterStep: number;
  isIdle: boolean;
  isReverse: boolean;
  isShimmer: boolean;
  draw: () => void;
  appear: () => void;
  disappear: () => void;
  shimmer: () => void;
};

function createPixel(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  color: string,
  baseSpeed: number,
  delay: number
): Pixel {
  const rand = (min: number, max: number) => Math.random() * (max - min) + min;

  const p: Pixel = {
    x,
    y,
    color,
    ctx,
    speed: rand(0.08, 0.4) * baseSpeed,
    size: 0,
    sizeStep: rand(0.12, 0.28),
    minSize: 0.5,
    maxSizeInt: 2,
    maxSize: rand(0.5, 2),
    delay,
    counter: 0,
    counterStep: rand(1.8, 3.2) + (canvas.width + canvas.height) * 0.008,
    isIdle: false,
    isReverse: false,
    isShimmer: false,
    draw() {
      const offset = p.maxSizeInt * 0.5 - p.size * 0.5;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x + offset, p.y + offset, p.size, p.size);
    },
    appear() {
      p.isIdle = false;
      if (p.counter <= p.delay) {
        p.counter += p.counterStep;
        return;
      }
      if (p.size >= p.maxSize) p.isShimmer = true;
      if (p.isShimmer) p.shimmer();
      else p.size += p.sizeStep;
      p.draw();
    },
    disappear() {
      p.isShimmer = false;
      p.counter = 0;
      if (p.size <= 0) {
        p.isIdle = true;
        return;
      }
      p.size -= 0.1;
      p.draw();
    },
    shimmer() {
      if (p.size >= p.maxSize) p.isReverse = true;
      else if (p.size <= p.minSize) p.isReverse = false;
      if (p.isReverse) p.size -= p.speed;
      else p.size += p.speed;
    },
  };

  return p;
}

function PixelCanvas({
  colors,
  gap = 6,
  speed = 30,
}: {
  colors: string[];
  gap?: number;
  speed?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pixelsRef = useRef<Pixel[]>([]);
  const animationRef = useRef(0);
  const lastFrameRef = useRef(performance.now());
  const reducedMotionRef = useRef(false);

  const init = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || colors.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = wrap.getBoundingClientRect();
    const w = Math.floor(width);
    const h = Math.floor(height);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const effectiveSpeed = reducedMotionRef.current ? 0 : Math.min(speed, 100) * 0.001;
    const pixels: Pixel[] = [];

    for (let x = 0; x < w; x += gap) {
      for (let y = 0; y < h; y += gap) {
        const color = colors[Math.floor(Math.random() * colors.length)]!;
        const dx = x - w / 2;
        const dy = y - h / 2;
        const delay = reducedMotionRef.current ? 0 : Math.sqrt(dx * dx + dy * dy) * 0.65;
        pixels.push(createPixel(ctx, canvas, x, y, color, effectiveSpeed, delay));
      }
    }

    pixelsRef.current = pixels;
  }, [colors, gap, speed]);

  const animate = useCallback((mode: "appear" | "disappear") => {
    cancelAnimationFrame(animationRef.current);
    const frameInterval = 1000 / 60;

    const loop = () => {
      animationRef.current = requestAnimationFrame(loop);
      const now = performance.now();
      const elapsed = now - lastFrameRef.current;
      if (elapsed < frameInterval) return;
      lastFrameRef.current = now - (elapsed % frameInterval);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const pixel of pixelsRef.current) pixel[mode]();
      if (pixelsRef.current.every((p) => p.isIdle)) {
        cancelAnimationFrame(animationRef.current);
      }
    };

    animationRef.current = requestAnimationFrame(loop);
  }, []);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    init();
    const resizeObserver = new ResizeObserver(() => init());
    if (wrapRef.current) resizeObserver.observe(wrapRef.current);
    animate("appear");
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animationRef.current);
    };
  }, [init, animate]);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

interface PixelHeroProps {
  word1?: string;
  word2?: string;
  description?: string;
  primaryCta?: string;
  primaryCtaMobile?: string;
  secondaryCta?: string;
  secondaryCtaMobile?: string;
  marqueeTitle?: string;
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
  externalUrl?: string;
}

export function PixelHero({
  word1 = "Silent",
  word2 = "Precision.",
  description = "Minimalist interfaces driven by refined motion. Every calculated detail delivers an elevated digital experience.",
  primaryCta = "Explore Design",
  primaryCtaMobile = "Explore",
  secondaryCta = "View Website",
  secondaryCtaMobile = "Website",
  marqueeTitle = "Trusted By Leading Brands",
  onPrimaryClick,
  onSecondaryClick,
  externalUrl = "https://sun-rack.com/",
}: PixelHeroProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setIsLoaded(true), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="relative isolate flex min-h-[100dvh] w-full flex-col justify-between overflow-hidden bg-[#050505] px-2 py-8 select-none sm:px-6 md:justify-center md:gap-6 md:py-0">
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 35s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-marquee { animation: none; }
        }
        .tahoe-glass-text {
            color: transparent;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 1) 0%,
            rgba(255, 255, 255, 0.45) 25%,
            rgba(255, 255, 255, 0.12) 45%,
            rgba(255, 255, 255, 0.92) 55%,
            rgba(255, 255, 255, 0.22) 75%,
            rgba(255, 255, 255, 1) 100%
          );
            background-size: 200% auto;
            -webkit-background-clip: text;
            background-clip: text;
          -webkit-text-stroke: 1px rgba(255, 255, 255, 0.25);
          filter: drop-shadow(0 12px 28px rgba(0, 0, 0, 0.45));
            animation: shimmer 8s linear infinite;
        }
        @keyframes shimmer {
            0% { background-position: 200% center; }
            100% { background-position: 0% center; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tahoe-glass-text { animation: none; }
        }
      `}</style>

      {/* Dot grid + pixel canvas */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-0">
        <PixelCanvas colors={DARK_PIXEL_COLORS} gap={6} speed={30} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#050505_100%)] opacity-90" />
      </div>

      {/* Sunrack logo */}
      <div
        className={cn(
          "relative z-10 flex justify-center pt-4 transition-all duration-1000 md:absolute md:left-8 md:top-8 md:justify-start md:pt-0",
          isLoaded ? "opacity-100" : "opacity-0"
        )}
      >
        <img
          src={SUNRACK_LOGO_DARK}
          alt="Sunrack Solar Structures"
          className="h-8 w-auto sm:h-10"
        />
      </div>

      {/* Headline */}
      <div className="pointer-events-none relative z-10 order-1 mt-24 flex w-full flex-col items-center justify-center text-center sm:mt-0">
        <h1 className="tahoe-glass-text flex w-full flex-row flex-wrap items-center justify-center gap-1.5 px-1 text-[2.8rem] leading-none sm:gap-4 sm:text-6xl md:text-8xl lg:text-9xl">
          <span className="font-serif font-medium italic">{word1}</span>
          <span className="font-sans font-extrabold tracking-tighter">{word2}</span>
        </h1>
      </div>

      {/* Description + mobile marquee */}
      <div className="relative z-10 order-2 my-auto flex w-full flex-col items-center justify-center px-1 text-center md:my-0">
        <p className="max-w-[95%] px-1 text-sm leading-relaxed font-light text-zinc-400 sm:max-w-md sm:text-lg md:max-w-xl md:text-xl">
          {description}
        </p>
        <div className="pointer-events-auto mt-14 block w-full max-w-4xl md:hidden">
          <BrandMarquee title={marqueeTitle} />
        </div>
      </div>

      {/* CTAs — light primary + ghost secondary (Pixel Perfect Hero style) */}
      <div
        className={cn(
          "relative z-10 order-4 flex transform flex-row items-center justify-center gap-3 px-1 transition-all duration-1000 md:order-3 md:mt-10",
          isLoaded ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
        )}
        style={{ transitionDelay: "450ms" }}
      >
        <button
          type="button"
          onClick={onPrimaryClick}
          className="relative inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-zinc-200 px-5 text-xs font-semibold text-zinc-900 shadow-lg transition-all duration-200 hover:scale-[1.02] hover:bg-white active:scale-[0.98] md:h-12 md:gap-2 md:px-8 md:text-sm"
        >
          <span className="inline md:hidden">{primaryCtaMobile}</span>
          <span className="hidden md:inline">{primaryCta}</span>
          <ArrowRight className="h-3.5 w-3.5 md:h-4 md:w-4" />
        </button>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onSecondaryClick}
          className="relative inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-zinc-600/80 bg-transparent px-5 text-xs font-semibold text-zinc-300 backdrop-blur-sm transition-all duration-200 hover:scale-[1.02] hover:border-zinc-400 hover:text-white active:scale-[0.98] md:h-12 md:gap-2 md:px-8 md:text-sm"
        >
          <ExternalLink className="h-3.5 w-3.5 md:h-4 md:w-4" />
          <span className="inline md:hidden">{secondaryCtaMobile}</span>
          <span className="hidden md:inline">{secondaryCta}</span>
        </a>
      </div>

      {/* Desktop marquee — Sunrack partner logos */}
      <div
        className={cn(
          "relative z-10 order-3 hidden w-full max-w-6xl transform flex-col items-center justify-center transition-all duration-1000 md:absolute md:bottom-8 md:left-1/2 md:flex md:-translate-x-1/2 md:order-4",
          isLoaded ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
        )}
        style={{ transitionDelay: "600ms" }}
      >
        <BrandMarquee title={marqueeTitle} className="pointer-events-auto px-4" />
      </div>
    </div>
  );
}
