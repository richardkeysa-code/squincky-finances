import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";

const InputSchema = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(120),
  dataBase64: z.string().min(4),
});

export type Transaction = {
  date: string;
  amount: number;
  type: "credit" | "debit";
  merchant: string;
  category: string;
  description: string;
};

export type ExtractResult = {
  documentType: string;
  currency: string;
  transactions: Transaction[];
};

const ExtractResultSchema = z.object({
  documentType: z.enum(["invoice", "receipt", "bank_statement", "other"]),
  currency: z.string(),
  transactions: z.array(
    z.object({
      date: z.string(),
      amount: z.number(),
      type: z.enum(["credit", "debit"]),
      merchant: z.string(),
      category: z.string(),
      description: z.string(),
    }),
  ),
});

const SUPPORTED_IMAGE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);
const SUPPORTED_DOC = new Set(["application/pdf"]);

const SYSTEM_PROMPT = `You are a meticulous financial document parser.

Given an invoice, receipt, or bank statement, extract EVERY transaction line.
Return ONLY valid JSON in this exact shape (no markdown, no commentary):
{
  "documentType": "invoice" | "receipt" | "bank_statement" | "other",
  "currency": "ISO 4217 code, e.g. USD, EUR, GBP, INR",
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "amount": <positive number, absolute value>,
      "type": "credit" | "debit",
      "merchant": "vendor / counterparty name",
      "category": "one of: Food & Dining, Groceries, Transport, Travel, Utilities, Rent, Shopping, Entertainment, Health, Education, Salary, Refund, Transfer, Fees, Taxes, Subscriptions, Business Services, Other",
      "description": "short human-readable description"
    }
  ]
}

Rules:
- A receipt/invoice with a single total = 1 transaction (debit).
- A bank statement = one row per line-item transaction.
- If a date is missing, use the document date. If none, use today.
- Amounts must be positive numbers; use "type" to indicate direction.
- Never invent transactions that aren't visible.
- If nothing looks like a transaction, return "transactions": [].`;

export const extractDocument = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<ExtractResult> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("AI service is not configured.");

    const mime = data.mimeType.toLowerCase();
    if (!SUPPORTED_IMAGE.has(mime) && !SUPPORTED_DOC.has(mime)) {
      throw new Error(`Unsupported file type: ${mime}. Please upload a PDF or image (JPG, PNG, HEIC).`);
    }

    const { createOpenAiProvider } = await import("./ai-gateway.server");
    const openai = createOpenAiProvider(apiKey);
    const model = openai("gpt-5.4-mini");

    const dataUrl = `data:${mime};base64,${data.dataBase64}`;
    const userContent = SUPPORTED_IMAGE.has(mime)
      ? [
          { type: "text" as const, text: "Extract every transaction from this document as JSON." },
          { type: "image" as const, image: dataUrl },
        ]
      : [
          { type: "text" as const, text: "Extract every transaction from this document as JSON." },
          { type: "file" as const, data: dataUrl, mediaType: mime, filename: data.fileName },
        ];

    let result;
    try {
      result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        output: Output.object({ schema: ExtractResultSchema }),
        providerOptions: {
          openai: { store: false, reasoningEffort: "low" },
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI request failed";
      if (msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("billing details")) {
        throw new Error("OpenAI API quota is unavailable. Add billing or credits to the OpenAI project, then try again.");
      }
      if (msg.includes("429")) throw new Error("Too many requests right now. Please try again in a moment.");
      if (msg.includes("402")) throw new Error("AI credits exhausted. Contact the workspace owner to add credits.");
      throw new Error(msg);
    }

    const parsed = result.output;

    const cleaned: ExtractResult = {
      documentType: String(parsed.documentType ?? "other"),
      currency: String(parsed.currency ?? "USD").toUpperCase().slice(0, 6),
      transactions: Array.isArray(parsed.transactions)
        ? parsed.transactions.map((t) => ({
            date: String(t.date ?? new Date().toISOString().slice(0, 10)),
            amount: Math.abs(Number(t.amount) || 0),
            type: t.type === "credit" ? "credit" : "debit",
            merchant: String(t.merchant ?? "").slice(0, 200),
            category: String(t.category ?? "Other").slice(0, 60),
            description: String(t.description ?? "").slice(0, 300),
          }))
        : [],
    };

    return cleaned;
  });
