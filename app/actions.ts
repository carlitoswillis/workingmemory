"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isListId } from "@/lib/lists";
import { createClient } from "@/lib/supabase/server";
import { getBoardAt, getHistory } from "@/lib/queries";
import type { ItemEvent } from "@/lib/types";
import type { BoardItemAt } from "@/lib/timetravel";

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

// Mutations are plain CRUD — the DB triggers append the history events, and RLS
// guarantees a user can only ever touch their own rows.

export async function addItemAction(text: string, list: string) {
  const t = text.trim();
  if (!t || !isListId(list)) return;
  const { supabase, user } = await requireUser();
  await supabase.from("items").insert({ text: t, list, user_id: user.id });
  revalidatePath("/");
}

export async function editItemAction(id: string, text: string) {
  const t = text.trim();
  if (!t) return;
  const { supabase } = await requireUser();
  await supabase.from("items").update({ text: t }).eq("id", id);
  revalidatePath("/");
}

export async function editDetailsAction(id: string, details: string) {
  // details may be empty (cleared); no trim-reject.
  const { supabase } = await requireUser();
  await supabase.from("items").update({ details }).eq("id", id);
  revalidatePath("/");
}

export async function moveItemAction(id: string, list: string) {
  if (!isListId(list)) return;
  const { supabase } = await requireUser();
  await supabase.from("items").update({ list }).eq("id", id);
  revalidatePath("/");
}

export async function toggleDoneAction(id: string, done: boolean) {
  const { supabase } = await requireUser();
  await supabase.from("items").update({ done }).eq("id", id);
  revalidatePath("/");
}

export async function archiveItemAction(id: string) {
  const { supabase } = await requireUser();
  await supabase.from("items").update({ archived: true }).eq("id", id);
  revalidatePath("/");
}

export async function setRecurrenceAction(id: string, recurrence: string) {
  const value = recurrence === "daily" ? "daily" : "none";
  const { supabase } = await requireUser();
  await supabase.from("items").update({ recurrence: value }).eq("id", id);
  revalidatePath("/");
}

// Check/uncheck a daily task for a given local date (null = uncheck).
export async function setDailyDoneAction(id: string, completedOn: string | null) {
  const { supabase } = await requireUser();
  await supabase.from("items").update({ completed_on: completedOn }).eq("id", id);
  revalidatePath("/");
}

export async function reorderItemAction(id: string, list: string, position: number) {
  if (!isListId(list)) return;
  const { supabase } = await requireUser();
  await supabase.from("items").update({ position, list }).eq("id", id);
  revalidatePath("/");
}

export async function saveListOrderAction(order: string[]) {
  const valid = order.filter(isListId);
  const { supabase, user } = await requireUser();
  await supabase
    .from("profiles")
    .upsert({ id: user.id, list_order: valid, updated_at: new Date().toISOString() });
  revalidatePath("/");
}

export async function historyAction(id: string): Promise<ItemEvent[]> {
  await requireUser();
  return getHistory(id);
}

export async function boardAtAction(t: string): Promise<BoardItemAt[]> {
  await requireUser();
  return getBoardAt(t);
}
