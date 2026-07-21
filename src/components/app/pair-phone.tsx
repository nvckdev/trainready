"use client";

import { useState } from "react";

/** The "send to phone" card: a one-line pairing code the mobile app's
 *  Settings screen decodes into name + thresholds + PMC seed. Pure copy —
 *  nothing is transmitted anywhere; the code travels however the user does. */
export function PairPhone({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the textarea below stays selectable.
    }
  };

  return (
    <div className="border border-hairline">
      <div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
        <span className="label-mono text-bone-faint">Send to phone</span>
        <button
          type="button"
          onClick={copy}
          className="label-mono text-[10px] border border-hairline px-2 py-1 text-bone hover:border-bone-faint"
        >
          {copied ? "COPIED" : "COPY CODE"}
        </button>
      </div>
      <div className="px-4 py-4 space-y-3">
        <p className="text-[13px] leading-relaxed text-bone-muted">
          Paste this into the Taper app under Settings → Import from dashboard. It carries your
          thresholds and today&apos;s fitness seed — anchored on logged history, not the demo
          athlete. Nothing is uploaded; the code only travels where you paste it.
        </p>
        <textarea
          readOnly
          value={code}
          rows={3}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full bg-field-sunken border border-hairline px-3 py-2 font-mono text-[11px] text-bone-muted break-all resize-none"
          aria-label="Pairing code for the Taper mobile app"
        />
      </div>
    </div>
  );
}
