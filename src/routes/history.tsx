import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Header } from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";

type Row = { id: string; file_name: string; transaction_count: number; created_at: string };

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Your conversions · Squincky" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate({ to: "/auth" }); return; }
    supabase
      .from("conversions")
      .select("id, file_name, transaction_count, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setRows(data ?? []));
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-gradient-hero">
      <Header />
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">Your conversions</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every document you've turned into an Excel sheet.</p>

        <div className="mt-8 rounded-2xl border border-border bg-card shadow-soft">
          {rows === null ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-medium text-foreground">No conversions yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">Upload a document to get started.</p>
              <Link to="/" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">Go to uploader →</Link>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3">Transactions</th>
                  <th className="px-4 py-3">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="truncate px-4 py-3 font-medium">{r.file_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.transaction_count}</td>
                    <td className="px-4 py-3 text-muted-foreground">{format(new Date(r.created_at), "PP p")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
