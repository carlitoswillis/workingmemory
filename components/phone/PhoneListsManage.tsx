"use client";

import { useEffect, useState, useTransition } from "react";
import { addListAction, deleteListAction, renameListAction, reorderListsAction } from "@/app/actions";
import { MAX_LIST_LABEL, type ListDef } from "@/lib/lists";
import { usePhoneUI } from "./PhoneShell";
import { Sheet, onFieldBlur, onFieldFocus, useSheetOpen } from "./Sheet";
import { usePhoneBoardData } from "./phone-data";

// Lists management (backlog §C "column add / rename / delete / reorder", brought
// back for the phone). Reachable from More and from a long-press on the Lists
// page's segmented header (PhoneList.tsx's `.phone-seg`).
//
// One row per column: tap the label to rename it in place, 44pt up/down buttons to
// reorder, and a delete that confirms IN THE ROW — a second tap on its own Delete
// button — rather than a browser confirm() the app never uses anywhere else. Every
// rule (MAX_LISTS, the last column can't go, a column still holding cards can't
// either) lives in lib/columns.ts; this sheet only calls the actions and prints
// back whatever they refuse with, same as PhoneCardMove's board-move arm/confirm.
//
// The note and the weekly review are sentinels, not columns, and never show up
// here: `usePhoneBoardData().lists` is lib/columns.ts#getLists, which only ever
// returns real column rows.

export default function PhoneListsManage() {
  const { close } = usePhoneUI();
  const { open: shown } = useSheetOpen();
  const { boardId, lists } = usePhoneBoardData();
  const [, startTransition] = useTransition();

  // Local order, settled under the finger the moment a button is tapped. Replaced
  // wholesale whenever the server's own `lists` changes shape — an add, a delete,
  // a rename or reorder from another device.
  const [order, setOrder] = useState<ListDef[]>(lists);
  useEffect(() => setOrder(lists), [lists]);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string | null; text: string } | null>(null);
  const [addDraft, setAddDraft] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  // A row that disappears from under an armed confirm (deleted elsewhere) can't
  // stay armed for a column that no longer exists.
  useEffect(() => {
    setConfirmId((id) => (id && order.some((l) => l.id === id) ? id : null));
  }, [order]);

  function startRename(id: string, label: string) {
    setConfirmId(null);
    setRenamingId(id);
    setDraftLabel(label);
  }

  function commitRename(id: string) {
    const name = draftLabel.trim();
    setRenamingId(null);
    const before = order.find((l) => l.id === id);
    if (!name || !before || name === before.label) return;
    setOrder((prev) => prev.map((l) => (l.id === id ? { ...l, label: name } : l)));
    setRowError(null);
    startTransition(async () => {
      const err = await renameListAction(boardId, id, name).catch(
        () => "The rename didn’t reach the server.",
      );
      if (!err) return;
      // Put the old label back and say why.
      setOrder((prev) => prev.map((l) => (l.id === id ? { ...l, label: before.label } : l)));
      setRowError({ id, text: err });
    });
  }

  function move(id: string, dir: -1 | 1) {
    const i = order.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setConfirmId(null);
    startTransition(() => reorderListsAction(boardId, next.map((l) => l.id)));
  }

  function askDelete(id: string) {
    setRenamingId(null);
    setRowError(null);
    setConfirmId(id);
  }

  function confirmDelete(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const err = await deleteListAction(boardId, id);
      setBusyId(null);
      if (err) {
        setRowError({ id, text: err });
        return;
      }
      setConfirmId(null);
      setOrder((prev) => prev.filter((l) => l.id !== id));
    });
  }

  function submitAdd() {
    const name = addDraft.trim();
    if (!name || addBusy) return;
    setAddDraft("");
    setRowError(null);
    setAddBusy(true);
    startTransition(async () => {
      const err = await addListAction(boardId, name);
      setAddBusy(false);
      if (err) {
        setRowError({ id: null, text: err });
        setAddDraft(name); // give the name back — it wasn't dropped, just refused
      }
    });
  }

  return (
    <Sheet
      open={shown}
      onOpenChange={(o) => !o && close()}
      label="Lists"
      heightSvh={80}
      className="wm-sheet--ledger"
    >
      <div className="wm-sheet__head">
        <p className="wm-ph-title" style={{ flex: 1 }}>
          Lists
        </p>
      </div>

      <div className="wm-sheet__scroll">
        <ul className="wm-ph-listmgr">
          {order.map((list, i) => {
            const confirming = confirmId === list.id;
            const busy = busyId === list.id;
            return (
              <li key={list.id} className="wm-ph-listmgr__row">
                <div className="wm-ph-listmgr__grid">
                  <div className="wm-ph-listmgr__reorder">
                    <button
                      type="button"
                      className="wm-ph-listmgr__move"
                      aria-label={`Move ${list.label} up`}
                      disabled={i === 0}
                      onClick={() => move(list.id, -1)}
                    >
                      <UpDown dir="up" />
                    </button>
                    <button
                      type="button"
                      className="wm-ph-listmgr__move"
                      aria-label={`Move ${list.label} down`}
                      disabled={i === order.length - 1}
                      onClick={() => move(list.id, 1)}
                    >
                      <UpDown dir="down" />
                    </button>
                  </div>

                  {renamingId === list.id ? (
                    <input
                      autoFocus
                      className="wm-ph-field wm-ph-listmgr__input"
                      value={draftLabel}
                      maxLength={MAX_LIST_LABEL}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") commitRename(list.id);
                        if (e.key === "Escape") {
                          // Reset the draft too: React removes this input on the
                          // state change below, and some browsers fire its blur
                          // (and therefore commitRename) synchronously as part of
                          // that removal — same guard Column.tsx's desktop rename
                          // uses for the identical race.
                          setDraftLabel(list.label);
                          setRenamingId(null);
                        }
                      }}
                      onFocus={onFieldFocus}
                      onBlur={() => {
                        onFieldBlur();
                        commitRename(list.id);
                      }}
                      aria-label={`Rename ${list.label}`}
                    />
                  ) : (
                    <button
                      type="button"
                      className="wm-ph-listmgr__label"
                      onClick={() => startRename(list.id, list.label)}
                      aria-label={`Rename ${list.label}`}
                      title="Rename"
                    >
                      {list.label}
                    </button>
                  )}

                  <div className="wm-ph-listmgr__actions">
                    {confirming ? (
                      <>
                        <button
                          type="button"
                          className="wm-ph-chip"
                          disabled={busy}
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="wm-ph-chip wm-ph-chip--warn"
                          disabled={busy}
                          onClick={() => confirmDelete(list.id)}
                        >
                          {busy ? "Deleting…" : "Delete"}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="wm-ph-chip"
                        onClick={() => askDelete(list.id)}
                        aria-label={`Delete ${list.label}`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {confirming && !rowError && (
                  <p className="wm-ph-hint wm-ph-listmgr__note">
                    Deleting is refused while a card is still on this list — move or
                    archive them first. This can&apos;t be undone.
                  </p>
                )}
                {rowError?.id === list.id && (
                  <p className="wm-ph-hint wm-ph-listmgr__note" style={{ color: "var(--now)" }} role="alert">
                    {rowError.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <form
          className="wm-ph-pad wm-ph-listmgr__add"
          onSubmit={(e) => {
            e.preventDefault();
            submitAdd();
          }}
        >
          {/* Adding a column is a DELIBERATE act, so it takes a deliberate tap (or the
              return key) — never a blur. The rename field above commits on blur because
              it edits a row that already exists; this one creates data, and blur is
              fired by the sheet's own dismiss, by any other row's button, and by tapping
              another label to rename it. Committing there wrote a column the user never
              asked for, out of sight, with only a delete (itself refused once the column
              holds a card) to undo it. The field only pays for the keyboard now; the
              button is the commit, and it is here because a phone keyboard does not
              always offer a return key. */}
          <div className="wm-ph-listmgr__addrow">
            <input
              className="wm-ph-field"
              value={addDraft}
              maxLength={MAX_LIST_LABEL}
              placeholder="Add a list…"
              aria-label="Add a list"
              onChange={(e) => setAddDraft(e.target.value)}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
            />
            <button
              type="submit"
              className="wm-ph-btn wm-ph-btn--auto"
              disabled={!addDraft.trim() || addBusy}
            >
              {addBusy ? "Adding…" : "Add"}
            </button>
          </div>
          {rowError?.id === null && (
            <p className="wm-ph-hint" style={{ marginTop: 6, color: "var(--now)" }} role="alert">
              {rowError.text}
            </p>
          )}
        </form>
      </div>
    </Sheet>
  );
}

// A plain chevron, folded into an up/down arrow (the app's one chevron path,
// rotated 90° off Sheet.tsx's — that one only turns left/right).
function UpDown({ dir }: { dir: "up" | "down" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden
      focusable="false"
      style={{ transform: dir === "down" ? "rotate(180deg)" : undefined }}
    >
      <path
        d="M3.5 10.5L8 5.5l4.5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
