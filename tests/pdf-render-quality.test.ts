import { describe, expect, it } from "vitest";
import { calculateRenderPlan, RENDER_MAX_PIXELS, RENDER_MAX_SIDE } from "../src/lib/pdf";

describe("PDF render quality plan", () => {
  it("renders more pixels as the requested zoom increases", () => {
    const normal = calculateRenderPlan(900, 1273, 900, 1);
    const zoomed = calculateRenderPlan(900, 1273, 1800, 1);
    expect(zoomed.width).toBeGreaterThan(normal.width);
    expect(zoomed.height).toBeGreaterThan(normal.height);
  });

  it("uses high-DPI rendering without unbounded device-pixel growth", () => {
    const plan = calculateRenderPlan(900, 1273, 1800, 4);
    expect(plan.width).toBeGreaterThan(1800);
    expect(plan.width).toBeLessThanOrEqual(RENDER_MAX_SIDE);
    expect(plan.width * plan.height).toBeLessThanOrEqual(RENDER_MAX_PIXELS);
  });

  it("keeps the render plan within a bounded memory budget", () => {
    const plan = calculateRenderPlan(900, 1273, 9000, 2.5);
    expect(plan.width * plan.height).toBeLessThanOrEqual(RENDER_MAX_PIXELS);
  });

  it("protects memory for an unusually large scanned page", () => {
    const plan = calculateRenderPlan(10_000, 20_000, 20_000, 2);
    expect(plan.limited).toBe(true);
    expect(plan.width * plan.height).toBeLessThanOrEqual(RENDER_MAX_PIXELS);
    expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(RENDER_MAX_SIDE);
  });
});
