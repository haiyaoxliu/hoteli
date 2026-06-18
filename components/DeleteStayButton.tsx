"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteStayButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!confirm("Delete this stay?")) return;
    setBusy(true);
    const res = await fetch(`/api/stays/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onDelete}
      disabled={busy}
      className="text-sm text-rose-400 hover:text-rose-300 disabled:opacity-50"
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
