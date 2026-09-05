"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "@/lib/types";
import { effectiveDone } from "@/lib/recurrence";
import PhoneRow from "./PhoneRow";
import { deriveNowSections, type NowSection } from "./phone-logic";

// Now — the home screen, and the reason the app opens where it does. Three sections
// in ONE vertical scroll: what you said you'd do today, what repeats and is still
// open, and (collapsed, count only) what's already gone. Opening onto the pager would
// cost a swipe before the most frequent action of the day, so it doesn't.
//
// Optimistic completion is owned HERE, not in the row: a row that flips has to keep
// its place for 900ms (with its Undo) even though the board data underneath it has
// already changed, and it has to land in Done today the moment it collapses — before
// the server has necessarily answered. Two maps do that:
//
//   optimistic — id → the checkbox's local truth, until the server agrees;
//   held       — id → the section it was tapped in, until its collapse finishes.

export default function PhoneHome({
  items,
  todayListId,
  today,
  snoozeListId = null,
}: {
  items: Item[];
  todayListId: string;
  today: string;
  // Where a row's "Later" sends a card — the Waiting column, when the board has one.
  snoozeListId?: string | null;
}) {
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  // Where each row is standing right now, read at the moment one is tapped. A ref,
  // because the callbacks below outlive any single render.
  const sectionRef = useRef<Map<string, NowSection>>(new Map());
  const [held, setHeld] = useState<Map<string, NowSection>>(new Map());
  const [showDone, setShowDone] = useState(false);

  // Sub-cards never render as rows; they're counted on their parent.
  const childrenByParent = useMemo(() => {
    const by = new Map<string, Item[]>();
    for (const it of items) {
      if (!it.parent_id) continue;
      const arr = by.get(it.parent_id);
      if (arr) arr.push(it);
      else by.set(it.parent_id, [it]);
    }
    return by;
  }, [items]);

  // Fold the optimistic checkbox into the data BEFORE deriving sections, so a checked
  // card is already a Done-today card by the time its collapse finishes — no flicker
  // waiting for the round trip. Repeating cards carry the date (done-ness is derived
  // from it), one-offs carry the flag.
  const view = useMemo(
    () =>
      items.map((it) => {
        const o = optimistic[it.id];
        if (o === undefined || o === effectiveDone(it, today)) return it;
        return it.recurrence !== "none"
          ? { ...it, completed_on: o ? today : null }
          : { ...it, done: o, updated_at: new Date().toISOString() };
      }),
    [items, optimistic, today],
  );

  const sections = useMemo(
    () => deriveNowSections(view, { today, todayListId, held }),
    [view, today, todayListId, held],
  );

  // The counts are derived a SECOND time without `held`, because the header and the
  // rows are answering different questions. `held` keeps a just-tapped row visible
  // where the thumb left it for 900ms; the count is a receipt and has to agree with
  // the tap in the same frame. Reading both off one pass is what made "Due today"
  // sit on a stale number for the length of the undo window.
  const counts = useMemo(
    () => deriveNowSections(view, { today, todayListId }),
    [view, today, todayListId],
  );

  // A row that has settled back onto the server's answer no longer needs an override.
  const onCheckedChange = useCallback((id: string, checked: boolean) => {
    setOptimistic((prev) => (prev[id] === checked ? prev : { ...prev, [id]: checked }));
  }, []);

  const onHold = useCallback(
    (id: string, holding: boolean) => {
      setHeld((prev) => {
        const next = new Map(prev);
        if (holding) {
          const section = sectionRef.current.get(id);
          if (section) next.set(id, section);
          else return prev;
        } else {
          if (!next.has(id)) return prev;
          next.delete(id);
        }
        return next;
      });
    },
    [], // sectionRef is a ref: always current, never a dependency
  );

  const placement = new Map<string, NowSection>();
  for (const it of sections.today) placement.set(it.id, "today");
  for (const it of sections.due) placement.set(it.id, "due");
  for (const it of sections.done) placement.set(it.id, "done");
  sectionRef.current = placement;

  // Retire an override once the server has caught up with it, so the map stays the
  // size of what is actually in flight rather than of everything ever ticked.
  useEffect(() => {
    setOptimistic((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [id, value] of Object.entries(prev)) {
        const item = items.find((i) => i.id === id);
        if (item && effectiveDone(item, today) === value) changed = true;
        else next[id] = value;
      }
      return changed ? next : prev;
    });
  }, [items, today]);

  const rowProps = (item: Item) => ({
    item,
    checked: optimistic[item.id] ?? effectiveDone(item, today),
    childItems: childrenByParent.get(item.id),
    today,
    snoozeListId,
    collapseOnDone: true,
    onCheckedChange,
    onHold,
    onSettled: (id: string) => onHold(id, false),
  });

  return (
    <div className="phone-scroll">
      <Section title="Today" count={counts.today.length}>
        {sections.today.length === 0 ? (
          <Empty>Nothing claimed for today.</Empty>
        ) : (
          <ul className="phone-rows">
            {sections.today.map((item) => (
              <PhoneRow key={item.id} {...rowProps(item)} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Due today" count={counts.due.length}>
        {sections.due.length === 0 ? (
          <Empty>Every repeating card is done for today.</Empty>
        ) : (
          <ul className="phone-rows">
            {sections.due.map((item) => (
              <PhoneRow key={item.id} {...rowProps(item)} />
            ))}
          </ul>
        )}
      </Section>

      {/* Done today is collapsed to its count — it's a receipt, not a workspace. */}
      <section className="phone-section">
        <button
          type="button"
          className="phone-section__toggle"
          aria-expanded={showDone}
          onClick={() => setShowDone((v) => !v)}
        >
          <span className="phone-section__title">Done today</span>
          <span className="phone-section__count tabular-nums">{counts.done.length}</span>
          <span className={`phone-chevron${showDone ? " is-open" : ""}`} aria-hidden>
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                d="M5.5 3.5L10.5 8l-5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
        {showDone && (
          <ul className="phone-rows">
            {sections.done.map((item) => (
              <PhoneRow key={item.id} {...rowProps(item)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="phone-section">
      <div className="phone-section__head">
        <h2 className="phone-section__title">{title}</h2>
        <span className="phone-section__count tabular-nums">{count || ""}</span>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="phone-empty">{children}</p>;
}
