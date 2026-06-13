"use client";

import { ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";

type Direction = "up" | "down" | "left" | "right" | "none";

interface AnimateInProps {
  children: ReactNode;
  className?: string;
  /** Delay in milliseconds (matches existing call sites e.g. delay={i * 90}) */
  delay?: number;
  direction?: Direction;
  once?: boolean;
}

/** Expo-out — fast start, long graceful settle. Reads as "expensive", never bouncy. */
const EASE = [0.16, 1, 0.3, 1] as const;
const TRAVEL = 22;

function offsetFor(direction: Direction) {
  switch (direction) {
    case "up":
      return { y: TRAVEL };
    case "down":
      return { y: -TRAVEL };
    case "left":
      return { x: TRAVEL };
    case "right":
      return { x: -TRAVEL };
    default:
      return {};
  }
}

export function AnimateIn({
  children,
  className = "",
  delay = 0,
  direction = "up",
  once = true,
}: AnimateInProps) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, filter: "blur(6px)", ...offsetFor(direction) }}
      whileInView={{ opacity: 1, x: 0, y: 0, filter: "blur(0px)" }}
      viewport={{ once, margin: "0px 0px -12% 0px" }}
      transition={{
        duration: 0.75,
        delay: delay / 1000,
        ease: EASE,
        opacity: { duration: 0.5, delay: delay / 1000, ease: "easeOut" },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggered group reveal — children animate in sequence as the group scrolls
 * into view. Uses a parent/child variant relationship so timing stays in sync.
 */
export function StaggerIn({
  children,
  className = "",
  stagger = 0.09,
  baseDelay = 0,
  direction = "up",
}: {
  children: ReactNode[];
  className?: string;
  stagger?: number;
  baseDelay?: number;
  direction?: Direction;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    return (
      <>
        {children.map((child, i) => (
          <div key={i} className={className}>
            {child}
          </div>
        ))}
      </>
    );
  }

  const container: Variants = {
    hidden: {},
    show: {
      transition: { staggerChildren: stagger, delayChildren: baseDelay },
    },
  };

  const item: Variants = {
    hidden: { opacity: 0, filter: "blur(6px)", ...offsetFor(direction) },
    show: {
      opacity: 1,
      x: 0,
      y: 0,
      filter: "blur(0px)",
      transition: { duration: 0.7, ease: EASE },
    },
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      style={{ display: "contents" }}
    >
      {children.map((child, i) => (
        <motion.div key={i} variants={item} className={className}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
