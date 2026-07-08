import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Zap } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function PaywallDialog({
  open,
  onOpenChange,
  isSignedIn,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isSignedIn: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">You've used your 5 free conversions today</DialogTitle>
          <DialogDescription>
            {isSignedIn
              ? "Upgrade for unlimited use, or grab a one-time pack."
              : "Sign in to keep your quota, then choose a plan below."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 pt-2 sm:grid-cols-2">
          <div className="rounded-2xl border-2 border-primary bg-gradient-to-br from-primary/5 to-primary/10 p-6 shadow-soft">
            <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
              <Zap className="h-3 w-3" /> Best value
            </div>
            <h3 className="text-lg font-bold">Squincky Pro</h3>
            <p className="mt-1 text-3xl font-extrabold">$12<span className="text-base font-medium text-muted-foreground">/mo</span></p>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex gap-2"><Check className="h-4 w-4 text-primary" /> Unlimited conversions</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-primary" /> Priority processing</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-primary" /> Conversion history</li>
            </ul>
            <Button className="mt-5 w-full bg-gradient-brand text-primary-foreground hover:opacity-95" disabled>
              Subscribe (coming soon)
            </Button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h3 className="text-lg font-bold">Top-up pack</h3>
            <p className="mt-1 text-3xl font-extrabold">$5</p>
            <p className="text-sm text-muted-foreground">one-time</p>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex gap-2"><Check className="h-4 w-4 text-primary" /> +100 conversions</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-primary" /> Never expires</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-primary" /> No subscription</li>
            </ul>
            <Button variant="outline" className="mt-5 w-full" disabled>
              Buy pack (coming soon)
            </Button>
          </div>
        </div>

        {!isSignedIn && (
          <div className="mt-2 rounded-lg border border-border bg-muted/50 p-3 text-center text-sm text-muted-foreground">
            <Link to="/auth" className="font-semibold text-primary hover:underline">Create an account</Link> to keep your conversion tokens across devices.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
