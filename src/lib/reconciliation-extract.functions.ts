import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import type { ReconciliationRow } from "./reconciliation";

const InputSchema = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(120),
  dataBase64: z.string().min(4),
  role: z.enum(["expected", "actual"]),
});

export type ReconciliationExtractResult = {
  documentType: string;
  provider: string;
  currency: string;
  rows: ReconciliationRow[];
  warnings: string[];
};

const SUPPORTED = new Set(["application/pdf"]);

const SYSTEM_PROMPT = `You are a meticulous financial operations data extraction engine.
Your job is to normalize settlement reports, bank statements, payment-gateway reports, and similar financial documents for reconciliation.

Return ONLY valid JSON in exactly this shape:
{
  "documentType": "bank_statement" | "settlement_report" | "transaction_report" | "other",
  "provider": "bank, payment gateway, marketplace, or source name if visible",
  "currency": "ISO 4217 code such as IDR or USD",
  "warnings": ["only include genuine extraction uncertainties"],
  "rows": [
    {
      "date": "YYYY-MM-DD",
      "reference": "transaction, settlement, transfer, RRN, invoice, or other stable reference if visible; otherwise empty string",
      "description": "original concise transaction or settlement description",
      "amount": 0,
      "grossAmount": null,
      "feeAmount": null,
      "netAmount": null
    }
  ]
}

Rules:
- Extract EVERY financially relevant row that can participate in reconciliation.
- Never invent a reference, date, amount, fee, or transaction.
- Preserve exact numeric values. All amount fields must be positive numbers.
- For payment-gateway settlement reports, prefer one row per settlement/batch when a clear settlement total exists. If the report is transaction-level, use one row per transaction.
- For bank statements, use credits/incoming settlement entries when the document is being used as the ACTUAL settlement source. Include debits only when clearly relevant to settlement adjustments/fees.
- For EXPECTED reports, capture expected net settlement when available in netAmount, gross in grossAmount, and fees in feeAmount.
- For ACTUAL bank statements, amount should be the received/posted settlement amount.
- If netAmount is visible, amount should equal netAmount. Otherwise amount should be the best amount for matching.
- Ignore running balances unless no transaction amount is shown.
- If multiple dates exist, prefer settlement/posting/value date over report-generation date.
- Use warnings for unclear tables, missing references, or ambiguous date/amount columns.
- Do not summarize. Do not aggregate unrelated rows.`;

export const extractReconciliationDocument = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<ReconciliationExtractResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI service is not configured.");

    const mime = data.mimeType.toLowerCase();
    if (!SUPPORTED.has(mime)) throw new Error("This extractor currently accepts PDF files.");

    const { createLovableAiGateway } = await import("./ai-gateway.server");
    const gateway = createLovableAiGateway(apiKey);
    const model = gateway("google/gemini-2.5-flash");
    const dataUrl = `data:${mime};base64,${data.dataBase64}`;

    const roleInstruction =
      data.role === "expected"
        ? "This is the EXPECTED source. Extract what should be settled or received."
        : "This is the ACTUAL source. Extract what was actually posted or received.";

    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text" as const, text: `${roleInstruction} File name: ${data.fileName}` },
            { type: "file" as const, data: dataUrl, mediaType: mime },
          ],
        },
      ],
      providerOptions: { lovable: { response_format: { type: "json_object" } } },
    });

    const text = result.text.trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("Could not extract structured settlement data from this PDF.");

    let parsed: any;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new Error("Could not parse the settlement data returned from the AI service.");
    }

    const currency = String(parsed.currency ?? "IDR").toUpperCase().slice(0, 6);
    const rows: ReconciliationRow[] = Array.isArray(parsed.rows)
      ? parsed.rows
          .map((row: any, index: number) => {
            const amount = Math.abs(Number(row.amount) || Number(row.netAmount) || 0);
            const net = row.netAmount == null ? undefined : Math.abs(Number(row.netAmount) || 0);
            const gross = row.grossAmount == null ? undefined : Math.abs(Number(row.grossAmount) || 0);
            const fee = row.feeAmount == null ? undefined : Math.abs(Number(row.feeAmount) || 0);
            return {
              id: `${data.role}-${index}-${String(row.reference ?? "").slice(0, 40)}`,
              date: String(row.date ?? "").slice(0, 10),
              reference: String(row.reference ?? "").slice(0, 160),
              description: String(row.description ?? "").slice(0, 300),
              amount,
              currency,
              ...(gross !== undefined ? { grossAmount: gross } : {}),
              ...(fee !== undefined ? { feeAmount: fee } : {}),
              ...(net !== undefined ? { netAmount: net } : {}),
            } satisfies ReconciliationRow;
          })
          .filter((row: ReconciliationRow) => row.amount > 0)
      : [];

    return {
      documentType: String(parsed.documentType ?? "other"),
      provider: String(parsed.provider ?? "Unknown").slice(0, 120),
      currency,
      rows,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((w: unknown) => String(w).slice(0, 300)).slice(0, 10) : [],
    };
  });
