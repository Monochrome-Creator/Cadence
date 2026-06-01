import { redirect } from "next/navigation";

/**
 * Root route — immediately redirect to the board.
 * Using a Server Component so the redirect happens before any HTML is sent
 * to the client (no flash, no client JS required).
 */
export default function RootPage() {
  redirect("/board");
}
