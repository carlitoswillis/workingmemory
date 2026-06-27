"use client";

export default function TimeMachineBar({
  value,
  onChange,
  onApply,
  onLive,
  loading,
  active,
  asOf,
}: {
  value: string;
  onChange: (v: string) => void;
  onApply: () => void;
  onLive: () => void;
  loading: boolean;
  active: boolean;
  asOf: string | null;
}) {
  return (
    <div
      className={`mb-5 flex flex-wrap items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 transition-colors ${
        active
          ? "border-[rgba(110,139,196,0.4)] bg-[rgba(110,139,196,0.08)]"
          : "border-[var(--veil-soft)] bg-[rgba(20,26,46,0.35)]"
      }`}
    >
      <span className="text-sm" aria-hidden>
        🕰
      </span>
      <span className="font-display text-[13px] italic text-[var(--text-mid)]">
        {active ? "Remembering" : "Time machine"}
      </span>

      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[var(--veil-soft)] bg-[var(--bg-0)] px-2.5 py-1 text-xs text-[var(--text-mid)] [color-scheme:dark] focus:border-[var(--now)] focus:outline-none"
      />
      <button
        onClick={onApply}
        disabled={loading || !value}
        className="rounded-lg border border-[var(--veil)] px-3 py-1 text-xs text-[var(--text-mid)] transition-colors hover:border-[var(--text-lo)] hover:text-[var(--text-hi)] disabled:opacity-40"
      >
        {loading ? "…" : "Rewind to here"}
      </button>

      {active && (
        <>
          <button
            onClick={onLive}
            className="rounded-lg px-3 py-1 text-xs font-medium text-[var(--bg-0)] transition-opacity hover:opacity-90"
            style={{ background: "var(--now)" }}
          >
            ← Back to now
          </button>
          <span className="ml-auto font-display text-xs italic text-[var(--past)]">
            as it was · {asOf ? new Date(asOf).toLocaleString() : ""}
          </span>
        </>
      )}
    </div>
  );
}
