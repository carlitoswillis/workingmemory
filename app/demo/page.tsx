import { redirect } from "next/navigation";
import { isDemoRequest } from "@/lib/db";
import BoardScreen from "@/app/BoardScreen";

// The anonymous visitor's throwaway demo board (per-cookie, seeded, swept —
// see lib/db.ts). Signed-in accounts and local mode have their board at "/",
// so anyone who isn't a demo visitor is sent there.
export const dynamic = "force-dynamic";

export default function DemoPage() {
  if (!isDemoRequest()) redirect("/");
  return <BoardScreen />;
}
