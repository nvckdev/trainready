"use client";

/**
 * Root error boundary: any server/render exception lands here instead of
 * Next's unstyled crash page. Styled like the rest of the instrument, honest
 * about what happened, and always offers a way back in.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-svh flex items-center justify-center px-6 bg-field">
      <div className="max-w-[480px]">
        <p className="label-mono text-signal-text">Fault recorded</p>
        <h1 className="display-engraved text-3xl mt-2">Something broke.</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-bone-muted">
          The page hit an error it couldn&apos;t recover from. Your training data and plan
          are untouched; this is a display fault, not a data fault.
        </p>
        {error.digest && (
          <p className="label-mono text-bone-faint mt-3">ref {error.digest}</p>
        )}
        <div className="mt-6 flex gap-4">
          <button
            onClick={reset}
            className="label-mono bg-signal text-field px-4 py-2.5 hover:bg-bone transition-colors duration-150"
          >
            Try again
          </button>
          <a
            href="/app"
            className="label-mono border border-hairline text-bone px-4 py-2.5 hover:border-bone transition-colors duration-150"
          >
            Back to Today
          </a>
        </div>
      </div>
    </div>
  );
}
