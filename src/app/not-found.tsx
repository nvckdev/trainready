import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-svh flex items-center justify-center px-6 bg-field">
      <div className="max-w-[480px]">
        <p className="label-mono text-bone-faint">404 · off course</p>
        <h1 className="display-engraved text-3xl mt-2">No route here.</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-bone-muted">
          This page doesn&apos;t exist. The plan does.
        </p>
        <div className="mt-6 flex gap-4">
          <Link
            href="/app"
            className="label-mono bg-signal text-field px-4 py-2.5 hover:bg-bone transition-colors duration-150"
          >
            Back to Today
          </Link>
          <Link
            href="/"
            className="label-mono border border-hairline text-bone px-4 py-2.5 hover:border-bone transition-colors duration-150"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
