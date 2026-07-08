import { supabase } from "@/integrations/supabase/client";

export const DAILY_FREE_LIMIT = 5;

const ANON_KEY = "squincky_anon_usage_v1";

type AnonUsage = { date: string; count: number };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function getAnonUsage(): AnonUsage {
  if (typeof window === "undefined") return { date: todayKey(), count: 0 };
  try {
    const raw = localStorage.getItem(ANON_KEY);
    if (!raw) return { date: todayKey(), count: 0 };
    const parsed = JSON.parse(raw) as AnonUsage;
    if (parsed.date !== todayKey()) return { date: todayKey(), count: 0 };
    return parsed;
  } catch {
    return { date: todayKey(), count: 0 };
  }
}

export function bumpAnonUsage() {
  const cur = getAnonUsage();
  const next = { date: todayKey(), count: cur.count + 1 };
  localStorage.setItem(ANON_KEY, JSON.stringify(next));
  return next;
}

export async function getUserUsage(userId: string): Promise<{ count: number; subscribed: boolean; extraCredits: number }> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [{ count }, { data: profile }] = await Promise.all([
    supabase
      .from("conversions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", startOfDay.toISOString()),
    supabase.from("profiles").select("subscribed, extra_credits").eq("id", userId).maybeSingle(),
  ]);
  return {
    count: count ?? 0,
    subscribed: profile?.subscribed ?? false,
    extraCredits: profile?.extra_credits ?? 0,
  };
}

export async function recordConversion(userId: string, fileName: string, transactionCount: number) {
  await supabase.from("conversions").insert({
    user_id: userId,
    file_name: fileName,
    transaction_count: transactionCount,
  });
}
