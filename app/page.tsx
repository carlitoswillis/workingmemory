import { isDemoRequest } from "@/lib/db";
import BoardScreen from "./BoardScreen";
import Landing from "./Landing";

// "/" is the board for signed-in accounts and local mode; on the hosted
// instance an anonymous visitor gets the landing page instead (their throwaway
// demo board lives at /demo — and is only created if they actually go there).
export const dynamic = "force-dynamic";

export default function Home() {
  if (isDemoRequest()) return <Landing />;
  return <BoardScreen />;
}
