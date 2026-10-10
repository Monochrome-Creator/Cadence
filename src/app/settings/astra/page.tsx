"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/utils/supabase/client";
import { IS_DEMO } from "@/store/use-prod-store";
import { withTimeout } from "@/store/cloud-sync";

export default function AstraConnectionPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connection, setConnection] = useState<string | null>(null);

  async function connect(revoke = false) {
    setBusy(true);
    setConnection(null);
    setMessage("");
    try {
      const client = getSupabaseClient();
      if (!client || IS_DEMO) throw new Error("Sign in to your real Cadence account first.");
      const { data: identity, error: identityError } = await withTimeout(client.auth.getUser(), "verify Cadence account");
      if (identityError || !identity.user) throw new Error("Sign in to your real Cadence account first.");
      const { data, error } = await withTimeout(client.rpc(revoke ? "revoke_astra_reader" : "issue_astra_reader"), "connect Astra");
      if (error) throw new Error("The connection is unavailable. The Cadence reader migration may still need to be installed.");
      if (revoke) { setMessage("Astra access revoked. Your Cadence tasks are unchanged."); return; }
      if (data?.account !== identity.user.email || !/^[0-9a-f]{64}$/.test(data?.token ?? "")) {
        throw new Error("The connection could not be verified.");
      }
      setConnection(JSON.stringify({
        version: 1, account: data.account, token: data.token,
        supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        anon_key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        expires_at: data.expires_at,
      }, null, 2));
      setMessage("Connection ready. Creating it again replaces the previous connection.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection unavailable.");
    } finally { setBusy(false); }
  }

  function download() {
    if (!connection) return;
    const url = URL.createObjectURL(new Blob([connection], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "cadence-reader.json"; anchor.click();
    URL.revokeObjectURL(url);
  }

  return <section className="mx-auto max-w-xl space-y-6 p-8">
    <Link href="/board">← Back to Cadence</Link>
    <h1 className="text-3xl font-semibold">Connect Astra</h1>
    <p>Astra will be able to read this account’s tasks, micro-tasks, goals and saved daily plan for your daily briefing. It cannot edit Cadence through this connection.</p>
    <p>The connection lasts 180 days. You can revoke it here at any time. Only cloud-synced changes are available to Astra; offline changes appear after they sync.</p>
    <div className="flex flex-wrap gap-3">
      <button className="rounded border px-4 py-3" disabled={busy} onClick={() => void connect()}>Allow Astra to read my Cadence</button>
      <button className="rounded border px-4 py-3" disabled={busy} onClick={() => void connect(true)}>Revoke Astra access</button>
    </div>
    {message && <p role="status">{message}</p>}
    {connection && <section className="space-y-3 rounded border p-4">
      <p>Download the connection file and import it into your local Astra agent. Keep this file private: it grants read access to your Cadence tasks and goals.</p>
      <button className="rounded border px-4 py-3" onClick={download}>Download Astra connection</button>
    </section>}
  </section>;
}
