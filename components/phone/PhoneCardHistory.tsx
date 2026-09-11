"use client";

import { describeRecurrence, parseRecurrence } from "@/lib/recurrence";
import { useEffect, useState } from "react";
import type { Item, ItemEvent } from "@/lib/types";
import type { Provenance } from "@/lib/doorways";
import { historyAction, provenanceAction } from "@/app/actions";
import { useBoardData, useDoorways } from "../board-context";
import { Chevron } from "./Sheet";
import { usePhoneBoardData } from "./phone-data";

// Card history, in the expanded card sheet — mirrors desktop CardPanel.tsx's
// History block (~884-942), same event fetch and the same describe() wording, but
// collapsed by default behind a row (this sheet is a peek-first surface, and a full
// event log is the least-glanced-at thing on a card) and rendered as flat facts —
// one line each, no dot-and-rule timeline — matching PhoneNote/PhoneReview's plain
// voice rather than the desktop's editorial rail.
//
// The provenance line ("Continued from a card on …") stays outside the disclosure:
// it's a single fact about where this card came from, not part of the log you have
// to open to read.

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function describe(
  e: ItemEvent,
  labelOf: (id: string) => string,
  titleOf: (id: string) => string,
  boardOf: (id: string) => string | null,
): string {
  switch (e.type) {
    case "created":
      return `Captured: "${e.new_value}"`;
    case "edited":
      if (e.field === "linked_board") {
        if (e.new_value) {
          const name = boardOf(e.new_value);
          return name ? `Linked to board "${name}"` : "Linked to a board";
        }
        const was = boardOf(e.old_value ?? "");
        return was ? `Unlinked from board "${was}"` : "Unlinked from a board";
      }
      if (e.field === "recurrence") {
        const r = parseRecurrence(e.new_value);
        return r.kind === "none" ? "No longer repeats" : `Now repeats: ${describeRecurrence(r)}`;
      }
      return e.field === "details" ? "Edited details" : "Reworded";
    case "moved":
      if (e.field === "parent") {
        if (e.new_value) return `Nested in "${titleOf(e.new_value)}"`;
        return `Moved out of "${titleOf(e.old_value ?? "")}" onto the board`;
      }
      return `Moved ${labelOf(e.old_value ?? "")} → ${labelOf(e.new_value ?? "")}`;
    case "completed":
      return e.field === "completed_on" ? `Checked off for ${e.new_value}` : "Marked done";
    case "reopened":
      if (e.field === "completed_on") return `Unchecked ${e.old_value}`;
      if (e.field === "archived") return "Restored from archive";
      return "Reopened";
    case "archived":
      return "Archived";
    default:
      return e.type;
  }
}

export default function PhoneCardHistory({ item, boardId }: { item: Item; boardId: string | null }) {
  const { items, listLabels } = usePhoneBoardData();
  const { doorways, myBoards } = useDoorways();
  const boardData = useBoardData();
  const actors = boardData?.actors ?? {};

  const labelOf = (id: string) => listLabels[id] ?? id;
  const titleOf = (id: string) => items.find((i) => i.id === id)?.text ?? "a card";
  const boardOf = (id: string) => doorways[id]?.name ?? myBoards.find((b) => b.id === id)?.name ?? null;

  const [events, setEvents] = useState<ItemEvent[] | null>(null);
  const [provenance, setProvenance] = useState<Provenance | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    setEvents(null);
    historyAction(boardId, item.id).then((e) => alive && setEvents(e));
    return () => {
      alive = false;
    };
  }, [boardId, item.id, item.updated_at]);

  useEffect(() => {
    setProvenance(null);
    if (!item.converted_from) return;
    let alive = true;
    provenanceAction(boardId, item.id).then((p) => alive && setProvenance(p));
    return () => {
      alive = false;
    };
  }, [boardId, item.id, item.converted_from]);

  return (
    <>
      {provenance && (
        <p className="wm-ph-card wm-ph-hint" style={{ marginTop: 18 }}>
          Continued from a card
          {provenance.boardName ? ` on ${provenance.boardName}` : ""} —{" "}
          <a
            href={
              provenance.boardId
                ? `/b/${provenance.boardId}?card=${provenance.itemId}`
                : `/?card=${provenance.itemId}`
            }
            className="wm-ph-history__link"
          >
            view original
          </a>
        </p>
      )}

      <section className="phone-section" style={{ padding: "10px 0 0" }}>
        <button
          type="button"
          className="phone-section__toggle"
          style={{ padding: "10px 0 6px" }}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="phone-section__title">History</span>
          {events && (
            <span className="phone-section__count tabular-nums">{events.length}</span>
          )}
          <span className={`phone-chevron${expanded ? " is-open" : ""}`} aria-hidden>
            <Chevron />
          </span>
        </button>

        {expanded &&
          (events === null ? (
            <p className="wm-ph-hint">Remembering…</p>
          ) : (
            <ol className="wm-ph-history">
              {events.map((e) => (
                <li key={e.id} className="wm-ph-history__item">
                  <p className="wm-ph-history__fact">{describe(e, labelOf, titleOf, boardOf)}</p>
                  <p className="wm-ph-history__meta">
                    {fmt(e.at)}
                    {e.actor_id && actors[e.actor_id] && ` · @${actors[e.actor_id]}`}
                  </p>
                </li>
              ))}
            </ol>
          ))}
      </section>
    </>
  );
}
