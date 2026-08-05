import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("ignore les branches conditionnelles fausses", () => {
    expect(cn("px-2", false && "hidden", "py-1")).toBe("px-2 py-1");
  });

  it("laisse la dernière classe l'emporter sur un conflit Tailwind", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
