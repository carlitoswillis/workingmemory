"use client";

import { useEffect, useState, useTransition } from "react";
import type { Item, ItemEvent } from "@/lib/types";
import type { LISTS } from "@/lib/lists";
import { listLabel } from "@/lib/lists";
import {
  archiveItemAction,
  editDetailsAction,
  editItemAction,
  historyAction,
  moveItemAction,
  setDailyDoneAction,
  setRecurrenceAction,
  toggleDoneAction,
} from "@/app/actions";
import { effectiveDone, localToday } from "@/lib/recurrence";

type ListDef = (typeof LISTS)[number];

function describe(e: ItemEvent): string {
  switch (e.type) {
    case "created":
      return `Captured: “${e.new_value}”`;
    case "edited":
      return e.field === "details" ? "Edited details" : "Reworded";
    case "moved":
      return `Moved ${listLabel(e.old_value ?? "")} → ${listLabel(e.new_value ?? "")}`;
    case "completed":
      return "Marked done";
    case "reopened":
      return "Reopened";
    case "archived":
      return "Archived";
    default:
      return e.type;
  }
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function CardPanel({
  item,
  allLists,
  onClose,
}: {
  item: Item;
  allLists: readonly ListDef[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.text);
  const [details, setDetails] = useState(item.details);
  const [events, setEvents] = useState<ItemEvent[] | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setTitle(item.text), [item.text]);
  useEffect(() => setDetails(item.details), [item.details]);
  useEffect(() => {
    let alive = true;
    historyAction(item.id).then((e) => alive && setEvents(e));
    return () => {
      alive = false;
    };
  }, [item.id, item.updated_at]);

  function saveTitle() {
    const t = title.trim();
    if (!t || t === item.text) return setTitle(item.text);
    startTransition(() => editItemAction(item.id, t));
  }
  function saveDetails() {
    if (details === item.details) return;
    startTransition(() => editDetailsAction(item.id, details));
  }

  const isDaily = item.recurrence === "daily";
  const effDone = effectiveDone(item);
  function toggleDone() {
    if (isDaily) {
      startTransition(() => setDailyDoneAction(item.id, effDone ? null : localToday()));
    } else {
      startTransition(() => toggleDoneAction(item.id, !item.done));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="card-in relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-[var(--veil)] bg-[var(--bg-1)] p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <button
            onClick={toggleDone}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors ${
              effDone
                ? "border-[var(--done)] text-[var(--done)]"
                : "border-[var(--veil)] text-[var(--text-mid)] hover:border-[var(--text-lo)]"
            }`}
          >
            <span
              className="grid h-3.5 w-3.5 place-items-center rounded-full border"
              style={{
                borderColor: effDone ? "var(--done)" : "var(--text-lo)",
                background: effDone ? "var(--done)" : "transparent",
              }}
            >
              {effDone && (
                <svg viewBox="0 0 12 12" className="h-2 w-2 text-[var(--bg-0)]">
                  <path d="M2.5 6.3l2.1 2.1 4.9-4.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            {effDone ? (isDaily ? "Done today" : "Done") : "Mark done"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-hi)]"
          >
            ✕
          </button>
        </div>

        {/* Title */}
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          rows={2}
          className="w-full resize-none rounded-lg border border-transparent bg-transparent px-1 py-1 font-display text-xl font-medium leading-snug text-[var(--text-hi)] hover:border-[var(--veil-soft)] focus:border-[var(--now)] focus:bg-[var(--bg-0)] focus:outline-none"
        />

        {/* Details */}
        <label className="mt-4 mb-1 block px-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-lo)]">
          Details
        </label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          onBlur={saveDetails}
          placeholder="Add context, links, the why… (Enter for a new line)"
          rows={6}
          className="w-full resize-y rounded-lg border border-[var(--veil-soft)] bg-[var(--bg-0)] px-3 py-2.5 font-display text-sm italic leading-relaxed text-[var(--text-hi)] placeholder:not-italic placeholder:text-[var(--text-lo)] focus:border-[var(--now)] focus:outline-none"
        />

        {/* List + archive */}
        <div className="mt-4 flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-lo)]">List</label>
          <select
            value={item.list}
            onChange={(e) => startTransition(() => moveItemAction(item.id, e.target.value))}
            className="rounded-md border border-[var(--veil-soft)] bg-[var(--bg-0)] px-2 py-1 text-xs text-[var(--text-mid)] focus:border-[var(--now)] focus:outline-none"
          >
            {allLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              startTransition(() => archiveItemAction(item.id));
              onClose();
            }}
            className="ml-auto rounded-md px-2 py-1 text-xs text-[var(--text-lo)] hover:bg-[var(--surface-2)] hover:text-[var(--text-mid)]"
          >
            Archive
          </button>
        </div>

        <button
          onClick={() => startTransition(() => setRecurrenceAction(item.id, isDaily ? "none" : "daily"))}
          className={`mt-3 flex items-center gap-2 rounded-md px-1 py-1 text-xs transition-colors ${
            isDaily ? "text-[var(--now)]" : "text-[var(--text-lo)] hover:text-[var(--text-mid)]"
          }`}
        >
          <span aria-hidden>↻</span>
          {isDaily ? "Repeats daily — resets each morning" : "Repeat daily"}
        </button>

        <p className="mt-3 px-1 text-[11px] text-[var(--text-lo)]">
          Captured {fmt(item.created_at)} · updated {fmt(item.updated_at)}
        </p>

        {/* History */}
        <div className="mt-6 border-t border-[var(--veil-soft)] pt-5">
          <p className="mb-4 font-display text-[11px] italic text-[var(--past)]">a memory of this thought</p>
          {events === null ? (
            <p className="font-display text-sm italic text-[var(--text-lo)]">Remembering…</p>
          ) : (
            <ol className="relative ml-1 border-l border-[var(--veil)] pl-5">
              {events.map((e, i) => (
                <li key={e.id} className="mb-4 last:mb-0">
                  <span
                    className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border"
                    style={{
                      borderColor: "var(--veil)",
                      background: i === events.length - 1 ? "var(--now)" : "var(--surface)",
                    }}
                  />
                  <p className="text-sm text-[var(--text-hi)]">{describe(e)}</p>
                  {e.type === "edited" && (
                    <p className="mt-1 font-display text-xs italic leading-snug text-[var(--text-lo)]">
                      <span className="line-through">{e.old_value}</span>{" "}
                      <span className="text-[var(--text-mid)]">→ {e.new_value}</span>
                    </p>
                  )}
                  <p className="mt-1 text-[11px] tabular-nums text-[var(--text-lo)]">{fmt(e.at)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
