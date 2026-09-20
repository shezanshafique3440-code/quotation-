import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getEnv, isAiConfigured } from "./env";
import { AppError, NotConfiguredError } from "./errors";

/**
 * Shape we ask Claude to return. Prices are in minor units so the model never
 * emits a float that we then have to re-round; every value is re-validated
 * server-side before it reaches the database.
 */
const draftSchema = z.object({
  title: z.string(),
  summary: z.string(),
  items: z.array(
    z.object({
      product_id: z.string(),
      description: z.string(),
      quantity: z.number(),
      unit: z.string(),
      unit_price_cents: z.number(),
    }),
  ),
  notes: z.string(),
  terms: z.string(),
  validity_days: z.number(),
  whatsapp_message: z.string(),
});

export type AiDraft = z.infer<typeof draftSchema>;

export interface CatalogEntry {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  unit: string;
  unitPriceCents: number;
}

export interface DraftRequest {
  business: {
    legalName: string;
    currency: string;
    defaultValidityDays: number;
    defaultTerms: string | null;
    defaultNotes: string | null;
  };
  customer: { name: string; company: string | null };
  inquiry: { subject: string; message: string; channel: string };
  catalog: CatalogEntry[];
  instructions?: string | undefined;
}

export interface DraftResult {
  draft: AiDraft;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM_PROMPT = `You are a quoting assistant for a small business. You turn a customer inquiry into a first-draft quotation that a human will review and edit before sending.

Rules:
- Only quote work the inquiry actually asks for. Do not invent scope to inflate the total.
- Prefer items from the supplied catalog. When an item comes from the catalog, set product_id to that catalog id and use its exact unit price.
- For work that is not in the catalog, set product_id to an empty string and choose a defensible price in the business's currency, in minor units (cents).
- quantity must be greater than zero. unit_price_cents must be a non-negative whole number.
- If the inquiry is too vague to price an item confidently, still include the line, and name the assumption you made in notes.
- notes is customer-facing: state assumptions, exclusions and what is needed to proceed.
- terms are payment and validity terms. Reuse the business defaults when they are supplied.
- whatsapp_message is a short, friendly message the owner can send to the customer alongside the quote. Plain text, no markdown, under 700 characters.
- Write in the same language the inquiry is written in.`;

function buildUserPrompt(request: DraftRequest): string {
  const catalog =
    request.catalog.length === 0
      ? "(empty — price every line from scratch)"
      : request.catalog
          .map(
            (p) =>
              `- id=${p.id} | ${p.name}${p.sku ? ` (SKU ${p.sku})` : ""} | ${p.unitPriceCents} cents per ${p.unit}${p.description ? ` | ${p.description}` : ""}`,
          )
          .join("\n");

  return [
    `Business: ${request.business.legalName}`,
    `Currency (minor units): ${request.business.currency}`,
    `Default validity: ${request.business.defaultValidityDays} days`,
    request.business.defaultTerms ? `Default terms: ${request.business.defaultTerms}` : null,
    request.business.defaultNotes ? `Default notes: ${request.business.defaultNotes}` : null,
    "",
    `Customer: ${request.customer.name}${request.customer.company ? ` — ${request.customer.company}` : ""}`,
    "",
    `Inquiry received via ${request.inquiry.channel}`,
    `Subject: ${request.inquiry.subject}`,
    "Message:",
    request.inquiry.message,
    "",
    "Product catalog:",
    catalog,
    request.instructions ? `\nExtra instructions from the business owner:\n${request.instructions}` : "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!isAiConfigured()) {
    throw new NotConfiguredError(
      "AI drafting is not configured. Set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY, then restart the server.",
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  }
  return client;
}

/** Test seam: inject a stub client so tests never reach the network. */
export function __setAiClientForTests(stub: Anthropic | null): void {
  client = stub;
}

export async function generateQuotationDraft(request: DraftRequest): Promise<DraftResult> {
  const env = getEnv();
  const anthropic = getClient();

  let response;
  try {
    response = await anthropic.messages.parse({
      model: env.AI_MODEL,
      max_tokens: env.AI_MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(request) }],
      output_config: { format: zodOutputFormat(draftSchema) },
    });
  } catch (error) {
    throw toAppError(error);
  }

  if (response.stop_reason === "refusal") {
    throw new AppError(
      "The AI assistant declined to draft this quotation. Edit the inquiry wording and try again, or write the quotation manually.",
      { status: 422, code: "ai_refusal" },
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new AppError(
      "The AI draft was cut short. Shorten the inquiry or raise AI_MAX_OUTPUT_TOKENS, then try again.",
      { status: 502, code: "ai_truncated" },
    );
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new AppError(
      "The AI assistant returned a draft that could not be read. Please try again.",
      { status: 502, code: "ai_unparseable" },
    );
  }

  return {
    draft: parsed,
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

function toAppError(error: unknown): AppError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new AppError("The configured AI API key was rejected. Check ANTHROPIC_API_KEY.", {
      status: 502,
      code: "ai_auth",
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AppError("The AI service is rate limited right now. Try again in a moment.", {
      status: 429,
      code: "ai_rate_limited",
    });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AppError("Could not reach the AI service. Check the server's network access.", {
      status: 502,
      code: "ai_unreachable",
    });
  }
  if (error instanceof Anthropic.APIError) {
    return new AppError(`The AI service returned an error (${error.status ?? "unknown"}).`, {
      status: 502,
      code: "ai_error",
    });
  }
  if (error instanceof AppError) return error;
  return new AppError("The AI draft could not be generated.", { status: 502, code: "ai_error" });
}
