import { describe, expect, it } from "vitest";
import { can, canActOn, isRole, INVITABLE_ROLES, ROLES } from "@/lib/roles";

describe("isRole", () => {
  it("accepts exactly the three roles", () => {
    expect(ROLES).toEqual(["owner", "admin", "member"]);
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole("")).toBe(false);
  });

  it("never offers ownership through an invitation", () => {
    expect(INVITABLE_ROLES).not.toContain("owner");
  });
});

describe("can", () => {
  it("gives the owner everything", () => {
    expect(can("owner", "members:manage")).toBe(true);
    expect(can("owner", "settings:manage")).toBe(true);
    expect(can("owner", "billing:manage")).toBe(true);
  });

  it("gives an admin everything except billing", () => {
    expect(can("admin", "members:manage")).toBe(true);
    expect(can("admin", "settings:manage")).toBe(true);
    expect(can("admin", "billing:manage")).toBe(false);
  });

  it("gives a member none of the workspace-level permissions", () => {
    expect(can("member", "members:manage")).toBe(false);
    expect(can("member", "settings:manage")).toBe(false);
    expect(can("member", "billing:manage")).toBe(false);
  });

  it("denies an unknown role rather than defaulting open", () => {
    expect(can("", "settings:manage")).toBe(false);
    expect(can("superuser", "billing:manage")).toBe(false);
  });
});

describe("canActOn", () => {
  it("lets an owner act on anyone", () => {
    expect(canActOn("owner", "owner")).toBe(true);
    expect(canActOn("owner", "admin")).toBe(true);
    expect(canActOn("owner", "member")).toBe(true);
  });

  it("stops an admin from touching the owner or another admin", () => {
    expect(canActOn("admin", "member")).toBe(true);
    expect(canActOn("admin", "admin")).toBe(false);
    expect(canActOn("admin", "owner")).toBe(false);
  });

  it("stops a member acting on anybody", () => {
    for (const target of ROLES) expect(canActOn("member", target)).toBe(false);
  });

  it("denies unknown roles on either side", () => {
    expect(canActOn("ghost", "member")).toBe(false);
    expect(canActOn("owner", "ghost")).toBe(false);
  });
});
