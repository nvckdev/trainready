"use client";

import { useRef, ReactNode } from "react";
import { motion, useInView } from "framer-motion";

interface AnimateInProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  once?: boolean;
}

const directionOffset = {
  up:    { y: 36, x: 0 },
  down:  { y: -36, x: 0 },
  left:  { x: 36, y: 0 },
  right: { x: -36, y: 0 },
  none:  { x: 0, y: 0 },
};

export function AnimateIn({
  children,
  className = "",
  delay = 0,
  direction = "up",
  once = true,
}: AnimateInProps) {
  const ref = useRef(null);
  const inView = useInView(ref, { once, margin: "-60px 0px" });
  const offset = directionOffset[direction];

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, ...offset }}
      animate={inView ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, ...offset }}
      transition={{
        duration: 0.7,
        delay: delay / 1000,
        ease: [0.21, 0.47, 0.32, 0.98],
      }}
    >
      {children}
    </motion.div>
  );
}

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
        <AnimateIn
          key={i}
          className={className}
          delay={baseDelay + i * stagger}
          direction={direction}
        >
          {child}
        </AnimateIn>
      ))}
    </>
  );
}
