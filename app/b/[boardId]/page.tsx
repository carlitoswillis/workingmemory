import { notFound } from "next/navigation";
import BoardScreen from "@/app/BoardScreen";
import { getRequestUserId, DEMO_MODE } from "@/lib/db";

// Any board the signed-in user is a member of. "/" stays the personal board;
// this renders the same BoardScreen scoped to a specific board (membership is
// verified inside getBoardContext, which 404s a non-member). On the hosted
// instance a request with no session is nobody's member — 404 rather than
// silently dropping them onto a demo board.
export const dynamic = "force-dynamic";

export default function BoardPage({ params }: { params: { boardId: string } }) {
  if (DEMO_MODE && !getRequestUserId()) notFound();
  return <BoardScreen boardId={params.boardId} />;
}
