import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  __setAiClientForTests,
  generateFollowUpMessage,
  generateQuotationDraft,
  type DraftRequest,
  type FollowUpRequest,
} from "@/lib/ai";
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


const followUpRequest: FollowUpRequest = {
  business: { legalName: "Northline Joinery", senderName: "Sam Rivera" },
  customer: { name: "Dana Whitfield", company: null },
  quotation: {
    number: "NJ-2026-0001",
    title: "Alcove shelving",
    totalFormatted: "£2,457.59",
    status: "sent",
    sentAgoDays: 4,
    validUntilFormatted: "11 Oct 2026",
    viewCount: 2,
    everViewed: true,
    notes: null,
  },
  previousFollowUps: 0,
};

const validFollowUp = {
  whatsapp_message: "Hi Dana, just checking in on the shelving quote — any questions?",
  email_subject: "Quick check-in on NJ-2026-0001",
  email_body: "Hi Dana,\n\nJust following up on the quotation I sent.\n\nSam",
};

describe("generateFollowUpMessage", () => {
  it("refuses to draft when no provider is configured", async () => {
    await expect(generateFollowUpMessage(followUpRequest)).rejects.toThrow(NotConfiguredError);
  });

  it("returns the drafted message and the model that wrote it", async () => {
    enableAi();
    __setAiClientForTests(
      stubClient({
        stop_reason: "end_turn",
        model: "claude-opus-5",
        parsed_output: validFollowUp,
        usage: { input_tokens: 400, output_tokens: 120 },
      }),
    );

    const result = await generateFollowUpMessage(followUpRequest);
    expect(result.draft.whatsapp_message).toContain("Dana");
    expect(result.draft.email_subject).toBeTruthy();
    expect(result.model).toBe("claude-opus-5");
    expect(result.usage).toEqual({ inputTokens: 400, outputTokens: 120 });
  });

  it("sends the model the recorded facts, and never a figure it could recompute", async () => {
    enableAi();
    let captured: { system?: string; messages?: { content: string }[] } = {};
    __setAiClientForTests({
      messages: {
        parse: async (params: { system: string; messages: { content: string }[] }) => {
          captured = params;
          return {
            stop_reason: "end_turn",
            model: "claude-opus-5",
            parsed_output: validFollowUp,
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    } as unknown as Anthropic);

    await generateFollowUpMessage(followUpRequest);

    const system = captured.system ?? "";
    expect(system).toMatch(/Never state a price/i);
    expect(system).toMatch(/Never offer a discount/i);
    expect(system).toMatch(/not sending anything/i);

    const prompt = captured.messages?.[0]?.content ?? "";
    expect(prompt).toContain("NJ-2026-0001");
    expect(prompt).toContain("£2,457.59");
    expect(prompt).toContain("opened the quote 2 time(s)");
  });

  it("tells the model when the customer has not opened the quote", async () => {
    enableAi();
    let prompt = "";
    __setAiClientForTests({
      messages: {
        parse: async (params: { messages: { content: string }[] }) => {
          prompt = params.messages[0]!.content;
          return {
            stop_reason: "end_turn",
            model: "claude-opus-5",
            parsed_output: validFollowUp,
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    } as unknown as Anthropic);

    await generateFollowUpMessage({
      ...followUpRequest,
      quotation: { ...followUpRequest.quotation, everViewed: false, viewCount: 0 },
    });

    expect(prompt).toContain("has not opened the quote yet");
  });

  it("surfaces a refusal, a truncation and an unreadable response distinctly", async () => {
    enableAi();

    for (const [response, code] of [
      [{ stop_reason: "refusal", parsed_output: null }, "ai_refusal"],
      [{ stop_reason: "max_tokens", parsed_output: null }, "ai_truncated"],
      [{ stop_reason: "end_turn", parsed_output: null }, "ai_unparseable"],
    ] as const) {
      __setAiClientForTests(
        stubClient({
          model: "claude-opus-5",
          usage: { input_tokens: 1, output_tokens: 1 },
          ...response,
        }),
      );
      await expect(generateFollowUpMessage(followUpRequest)).rejects.toMatchObject({ code });
    }
  });

  it("does not leak transport detail into the user-facing message", async () => {
    enableAi();
    __setAiClientForTests({
      messages: {
        parse: async () => {
          throw new Error("ECONNRESET at 10.0.0.5:443");
        },
      },
    } as unknown as Anthropic);

    const error = (await generateFollowUpMessage(followUpRequest).catch((e) => e)) as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).not.toContain("10.0.0.5");
  });
});
