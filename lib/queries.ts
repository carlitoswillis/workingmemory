import { createClient } from "./supabase/server";
import type { Item, ItemEvent } from "./types";
import { reconstructBoardAt, type BoardItemAt } from "./timetravel";

// All reads run through the authed server client; RLS scopes them to the user.

export async function getItems(): Promise<Item[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("archived", false)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Item[];
}

// The user's saved column (list) order, or null if they've never reordered.
export async function getListOrder(): Promise<string[] | null> {
  const supabase = createClient();
  const { data } = await supabase.from("profiles").select("list_order").maybeSingle();
  const order = data?.list_order;
  return Array.isArray(order) ? (order as string[]) : null;
}

export async function getHistory(itemId: string): Promise<ItemEvent[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("item_events")
    .select("*")
    .eq("item_id", itemId)
    .order("at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ItemEvent[];
}

// Reconstruct the whole board as it was at time `t`. Both reads go through the
// authed client, so RLS scopes everything to the current user — time-travel is
// per-user by construction, just like the live board.
export async function getBoardAt(t: string): Promise<BoardItemAt[]> {
  const supabase = createClient();
  const [itemsRes, eventsRes] = await Promise.all([
    supabase.from("items").select("*"), // include archived — they may have been visible at T
    supabase.from("item_events").select("*").order("at", { ascending: true }),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (eventsRes.error) throw eventsRes.error;
  return reconstructBoardAt(
    (itemsRes.data ?? []) as Item[],
    (eventsRes.data ?? []) as ItemEvent[],
    t,
  );
}
