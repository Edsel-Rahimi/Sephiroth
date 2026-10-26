"use client";

import { cn } from "@/lib/utils";

export function BrandMark({
  size = 36,
  pulse = false,
  className,
}: {
  size?: number;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <img
      src="/sephiroth-logo.png"
      alt="Sephiroth"
      width={size}
      height={size}
      className={cn(
        "rounded-[10px] ring-1 ring-white/10 select-none",
        pulse && "logo-pulse",
        className
      )}
      draggable={false}
    />
  );
}

export function BrandWord({
  tagline,
  className,
}: {
  tagline?: string;
  className?: string;
}) {
  return (
    <span className={cn("leading-none", className)}>
      <span className="text-silver font-bold tracking-[0.24em] text-[13px] block">
        SEPHIROTH
      </span>
      <span className="text-[9px] tracking-[0.32em] text-muted-foreground/80 uppercase block mt-1">
        {tagline ?? "Control Panel"}
      </span>
    </span>
  );
}
