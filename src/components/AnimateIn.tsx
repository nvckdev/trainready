"use client";

import { useEffect, useRef, useState, ReactNode } from "react";

interface AnimateInProps {
  children: ReactNode;
  className?: string;
  delay?: number; // ms
  direction?: "up" | "down" | "left" | "right" | "none";
  once?: boolean;
}

export function AnimateIn({
  children,
  className = "",
  delay = 0,
  direction = "up",
  once = true,
}: AnimateInProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setVisible(false);
        }
      },
      { threshold: 0.12 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [once]);

  const translate = {
    up: "translateY(28px)",
    down: "translateY(-28px)",
    left: "translateX(28px)",
    right: "translateX(-28px)",
    none: "none",
  }[direction];

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : translate,
        transition: `opacity 0.65s cubic-bezier(0.4,0,0.2,1) ${delay}ms, transform 0.65s cubic-bezier(0.4,0,0.2,1) ${delay}ms`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

/** Stagger a list of children — each animates in with an increasing delay */
export function StaggerIn({
  children,
  className = "",
  stagger = 80,
  baseDelay = 0,
  direction = "up",
}: {
  children: ReactNode[];
  className?: string;
  stagger?: number;
  baseDelay?: number;
  direction?: AnimateInProps["direction"];
}) {
  return (
    <>
      {children.map((child, i) => (
        <AnimateIn key={i} delay={baseDelay + i * stagger} direction={direction} className={className}>
          {child}
        </AnimateIn>
      ))}
    </>
  );
}
