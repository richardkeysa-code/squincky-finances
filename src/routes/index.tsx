import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, Sparkles, Shield, Zap } from "lucide-react";
import { Header } from "@/components/Header";
import { FileUploader } from "@/components/FileUploader";
import { useAuth } from "@/lib/use-auth";
import { DAILY_FREE_LIMIT, getAnonUsage, getUserUsage } from "@/lib/quota";

export const Route = createFileRoute("/")({
  component: Index,
});

function UsageBadge() {
  const { user, loading } = useAuth();
  const [used, setUsed] = useState<number | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [extra, setExtra] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (user) {
      getUserUsage(user.id).then((u) => {
        setUsed(u.count);
        setSubscribed(u.subscribed);
        setExtra(u.extraCredits);
      });
    } else {
      setUsed(getAnonUsage().count);
    }
  }, [user, loading]);

  if (loading || used === null) return null;
  if (subscribed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-brand px-3 py-1 text-xs font-semibold text-primary-foreground">
        <Sparkles className="h-3 w-3" /> Pro · Unlimited
      </span>
    );
  }
  const cap = DAILY_FREE_LIMIT + extra;
  const remaining = Math.max(0, cap - used);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
      <span className={remaining === 0 ? "text-destructive" : "text-primary"}>{remaining}</span>
      <span>of {cap} free conversions left today</span>
    </span>
  );
}

function Index() {
  return (
    <div className="min-h-screen bg-gradient-hero">
      <Header />
      <main className="mx-auto w-full max-w-4xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        <section className="mb-10 text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3 w-3" /> AI-powered · Ready-for-accounting Excel
          </div>
          <h1 className="text-balance text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Turn any receipt or statement into <span className="bg-gradient-brand bg-clip-text text-transparent">clean Excel</span>.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
            Drop an invoice, receipt, or bank statement. Squincky's AI extracts every transaction — date, amount, merchant, category, description — ready to download.
          </p>
          <div className="mt-5 flex justify-center">
            <UsageBadge />
          </div>
        </section>

        <FileUploader />

        <section className="mt-16 grid gap-6 sm:grid-cols-3">
          {[
            { icon: FileText, title: "Any document", body: "PDF invoices, phone photos of receipts, multi-page bank statements — all supported." },
            { icon: Zap, title: "Structured in seconds", body: "Each row includes date, amount, merchant, category, and a short description." },
            { icon: Shield, title: "Your data stays yours", body: "Files are processed on the fly and never stored on our servers." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-foreground">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        <footer className="mt-16 border-t border-border/60 pt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Squincky. Built for founders, freelancers, and finance teams.
        </footer>
      </main>
    </div>
  );
}
