import { describe, it, expect } from "vitest";
import { classifyPdfError } from "../src/lib/pdfErrors";

describe("PDF error messages", () => {
  it("explains a password-protected file", () => {
    expect(classifyPdfError(Object.assign(new Error("No password given"), { name: "PasswordException" }))).toContain("كلمة مرور");
  });
  it("explains a damaged file", () => {
    expect(classifyPdfError(new Error("Invalid PDF structure"))).toContain("تالف");
  });
  it("explains a file that cannot be reached", () => {
    expect(classifyPdfError(new Error("Failed to fetch"))).toContain("الوصول");
  });
  it("explains a file too large for memory", () => {
    expect(classifyPdfError(new Error("Out of memory"))).toContain("كبير");
  });
  it("falls back to a general message", () => {
    expect(classifyPdfError(new Error("something else"))).toContain("تأكد من وجوده");
  });
});
