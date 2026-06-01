import { describe, it, expect } from "vitest";
import { getInsight } from "../../src/services/weatherInsights.js";

describe("getInsight", () => {
  it("condition connue → insight avec un template non vide", () => {
    const i = getInsight("cloudy");
    expect(i).toBeTruthy();
    expect(i.template.title).toBeTruthy();
    expect(i.template.message).toBeTruthy();
  });
  it("condition inconnue → fallback 'cloudy'", () => {
    expect(getInsight("___inconnu___")).toBe(getInsight("cloudy"));
  });
});
