import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { __setAiClientForTests, generateQuotationDraft, type DraftRequest } from "@/lib/ai";
import { isAiConfigured, resetEnvCache } from "@/lib/env";
import { AppError, NotConfiguredError } from "@/lib/errors";

const request: DraftRequest = {
  business: {
    legalName: "Northline Joinery",
    currency: "GBP",
    defaultValidityDays: 21,
    defaultTerms: null,
    defaultNotes: null,
  },
  customer: { name: "Dana Whitfield", company: null },
  inquiry: { subject: "Shelving", message: "Two alcoves please.", channel: "whatsapp" },
  catalog: [
    {
      id: "prod_1",
      name: "Oak shelving",
      description: null,
      sku: "OAK",
      unit: "metre",
      unitPriceCents: 18_500,
    },
  ],
};

const validDraft = {
  title: "Alcove shelving",
  summary: "Two alcoves in oak.",
  items: [
    {
      product_id: "prod_1",
      description: "Oak shelving",
      quantity: 3.6,
      unit: "metre",
      unit_price_cents: 18_500,
    },
  ],
  notes: "",
  terms: "",
  validity_days: 21,
  whatsapp_message: "Hi Dana!",
};

function stubClient(response: unknown): Anthropic {
  return {
    messages: { parse: async () => response },
  } as unknown as Anthropic;
}

function enableAi() {
  process.env.AI_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  resetEnvCache();
}

afterEach(() => {
  process.env.AI_PROVIDER = "none";
  delete process.env.ANTHROPIC_API_KEY;
  resetEnvCache();
  __setAiClientForTests(null);
});

describe("AI configuration", () => {
  it("reports itself as off when no provider is configured", () => {
    expect(isAiConfigured()).toBe(false);
  });

  it("refuses to draft rather than inventing a quotation", async () => {
    await expect(generateQuotationDraft(request)).rejects.toThrow(NotConfiguredError);
  });

  it("reports itself as on once a provider and key are present", () => {
    enableAi();
    expect(isAiConfigured()).toBe(true);
  });

  it("fails fast when the provider is set without a key", () => {
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    resetEnvCache();
    expect(() => isAiConfigured()).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("generateQuotationDraft", () => {
  it("returns the parsed draft and the model that produced it", async () => {
    enableAi();
    __setAiClientForTests(
      stubClient({
        stop_reason: "end_turn",
        model: "claude-opus-5",
        parsed_output: validDraft,
        usage: { input_tokens: 900, output_tokens: 250 },
      }),
    );

    const result = await generateQuotationDraft(request);
    expect(result.draft.items[0]!.product_id).toBe("prod_1");
    expect(result.model).toBe("claude-opus-5");
    expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 250 });
  });

  it("surfaces a refusal instead of returning an empty quotation", async () => {
    enableAi();
    __setAiClientForTests(
      stubClient({
        stop_reason: "refusal",
        model: "claude-opus-5",
        parsed_output: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
    );

    await expect(generateQuotationDraft(request)).rejects.toMatchObject({ code: "ai_refusal" });
  });

  it("surfaces a truncated response rather than saving half a draft", async () => {
    enableAi();
    __setAiClientForTests(
      stubClient({
        stop_reason: "max_tokens",
        model: "claude-opus-5",
        parsed_output: null,
        usage: { input_tokens: 10, output_tokens: 4_000 },
      }),
    );

    await expect(generateQuotationDraft(request)).rejects.toMatchObject({ code: "ai_truncated" });
  });

  it("surfaces an unparseable response", async () => {
    enableAi();
    __setAiClientForTests(
      stubClient({
        stop_reason: "end_turn",
        model: "claude-opus-5",
        parsed_output: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );

    await expect(generateQuotationDraft(request)).rejects.toMatchObject({
      code: "ai_unparseable",
    });
  });

  it("converts a transport failure into a safe, user-facing error", async () => {
    enableAi();
    __setAiClientForTests({
      messages: {
        parse: async () => {
          throw new Error("ECONNRESET at 10.0.0.5:443");
        },
      },
    } as unknown as Anthropic);

    const error = (await generateQuotationDraft(request).catch((e) => e)) as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).not.toContain("10.0.0.5");
  });
});
