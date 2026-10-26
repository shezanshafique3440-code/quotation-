import { beforeEach, describe, expect, it, vi } from "vitest";
import { idleState } from "@/lib/action-state";
import { prisma } from "@/lib/db";
import { centsToInput } from "@/lib/format";
import { requireSession, type SessionContext } from "@/lib/session";
import { createProductAction, updateProductAction } from "@/server/product-actions";
import { createWorkspace, resetDatabase, type Workspace } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDatabase();
});

async function signIn(workspace: Workspace) {
  const [user, organization] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: workspace.userId } }),
    prisma.organization.findUniqueOrThrow({ where: { id: workspace.organizationId } }),
  ]);
  const session: SessionContext = {
    sessionId: "test-session",
    userId: user.id,
    organizationId: organization.id,
    user,
    organization,
    role: "owner",
  };
  vi.mocked(requireSession).mockResolvedValue(session);
}

function productForm(unitPrice: string, id?: string): FormData {
  const form = new FormData();
  form.set("name", "Currency test product");
  form.set("unitPrice", unitPrice);
  form.set("unit", "unit");
  form.set("taxRate", "0");
  form.set("active", "on");
  // The server must derive the scale from the tenant profile, even if a
  // request supplies its own unrelated currency field.
  form.set("currency", "USD");
  if (id) form.set("id", id);
  return form;
}

const currencies = [
  { currency: "JPY", amount: "1200", minorUnits: 1200 },
  { currency: "KWD", amount: "12.345", minorUnits: 12345 },
  { currency: "USD", amount: "12.34", minorUnits: 1234 },
];

describe("catalog currency amounts", () => {
  it.each(currencies)("creates a $currency product using its actual minor-unit scale", async ({
    currency, amount, minorUnits,
  }) => {
    const workspace = await createWorkspace({ currency });
    await signIn(workspace);

    const state = await createProductAction(idleState, productForm(amount));
    expect(state.status).toBe("success");
    const product = await prisma.product.findFirstOrThrow({
      where: { organizationId: workspace.organizationId, name: "Currency test product" },
    });
    expect(product.unitPriceCents).toBe(minorUnits);
  });

  it.each(currencies)("round-trips a $currency price when editing an existing product", async ({
    currency, minorUnits,
  }) => {
    const workspace = await createWorkspace({ currency });
    await signIn(workspace);
    await prisma.product.update({
      where: { id: workspace.productId },
      data: { unitPriceCents: minorUnits },
    });

    const input = centsToInput(minorUnits, currency);
    const state = await updateProductAction(idleState, productForm(input, workspace.productId));
    expect(state.status).toBe("success");
    expect(await prisma.product.findUniqueOrThrow({
      where: { id: workspace.productId },
    })).toMatchObject({ unitPriceCents: minorUnits });
  });

  it("does not change another workspace's catalog through a forged edit", async () => {
    const mine = await createWorkspace({ currency: "JPY" });
    const theirs = await createWorkspace({ currency: "USD" });
    await signIn(mine);

    const state = await updateProductAction(idleState, productForm("1200", theirs.productId));
    expect(state.status).toBe("error");
    expect(await prisma.product.findUniqueOrThrow({
      where: { id: theirs.productId },
    })).toMatchObject({ unitPriceCents: 10_000 });
  });
});
