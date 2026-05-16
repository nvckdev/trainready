import { ReactNode } from "react";

interface AnimateInProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  once?: boolean;
}

export function AnimateIn({ children, className = "" }: AnimateInProps) {
  return <div className={className}>{children}</div>;
}

export function StaggerIn({
  children,
  className = "",
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
        <div key={i} className={className}>{child}</div>
      ))}
    </>
  );
}
