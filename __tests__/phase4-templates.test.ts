import { describe, expect, it } from "vitest";

import { mapTemplateParams, renderTemplate } from "../src/services/whatsapp.service";

describe("renderTemplate", () => {
  it("replaces positional placeholders in order", () => {
    expect(renderTemplate("Hello {{1}}, your booking {{2}} is {{3}}.", ["Asha", "BK-1001", "confirmed"])).toBe(
      "Hello Asha, your booking BK-1001 is confirmed.",
    );
  });

  it("replaces a repeated placeholder every time", () => {
    expect(renderTemplate("{{1}} and {{1}}", ["x"])).toBe("x and x");
  });

  it("renders missing params as empty strings", () => {
    expect(renderTemplate("Hello {{1}}, code {{2}}.", ["Asha"])).toBe("Hello Asha, code .");
    expect(renderTemplate("Hi {{5}}", ["a"])).toBe("Hi ");
  });

  it("ignores extra params", () => {
    expect(renderTemplate("Hi {{1}}", ["a", "b", "c"])).toBe("Hi a");
  });

  it("leaves bodies without placeholders untouched", () => {
    expect(renderTemplate("No placeholders here.", [])).toBe("No placeholders here.");
  });

  it("handles multi-digit positions", () => {
    const params = Array.from({ length: 10 }, (_, i) => `p${i + 1}`);
    expect(renderTemplate("{{10}} then {{1}}", params)).toBe("p10 then p1");
  });
});

describe("mapTemplateParams (variable mapping order)", () => {
  it("orders values by position", () => {
    const vars = [
      { position: 2, source: "bookingReference" },
      { position: 1, source: "customerName" },
    ];
    expect(
      mapTemplateParams(vars, { customerName: "Asha", bookingReference: "BK-1001" }),
    ).toEqual(["Asha", "BK-1001"]);
  });

  it("resolves missing sources to empty strings", () => {
    const vars = [
      { position: 1, source: "customerName" },
      { position: 2, source: "missing" },
    ];
    expect(mapTemplateParams(vars, { customerName: "Asha" })).toEqual(["Asha", ""]);
  });

  it("ignores extra bag keys", () => {
    expect(mapTemplateParams([{ position: 1, source: "a" }], { a: "1", b: "2" })).toEqual(["1"]);
  });

  it("returns [] for templates without variables", () => {
    expect(mapTemplateParams([], { a: "1" })).toEqual([]);
  });
});
