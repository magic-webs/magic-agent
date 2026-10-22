import { describe, expect, test } from "bun:test";
import { renderTemplate, variablesIn } from "../convex/lib/marketing";
import {
  cleanFills,
  fillProblems,
  fillsFor,
  personalValues,
  type Person,
  type SharedValues,
  type VariableFill,
} from "../convex/lib/personalise";

const shared: SharedValues = {
  business: "Urmil Jewellers",
  event: "Grand Opening",
  date: "Wednesday, 26 August",
  venue: "",
  message: "",
};

const rahul: Person = {
  name: "Rahul Verma",
  externalId: "919812345678",
  email: "rahul@example.com",
  birthday: "11-08",
  attributes: [{ key: "City", value: "Shahdara" }],
};

describe("fills", () => {
  test("defaults keep today's behaviour", () => {
    const body = "Hi {{name}}, {{message}} — {{business}}";
    expect(variablesIn(body)).toEqual(["name", "message", "business"]);
    const fills = fillsFor(body, undefined, "Doors open at 11");
    const { text } = renderTemplate(body, personalValues(fills, shared, rahul));
    expect(text).toBe("Hi Rahul, Doors open at 11 — Urmil Jewellers");
  });

  test("each blank reads the field it was given", () => {
    const body = "Hello {{name}} from {{message}}, born {{event}}";
    const fills: VariableFill[] = [
      { variable: "name", source: "full_name", fallback: "friend" },
      { variable: "message", source: "attribute", key: "city", fallback: "Delhi" },
      { variable: "event", source: "birthday", fallback: "—" },
    ];
    const { text, parameters } = renderTemplate(body, personalValues(fills, shared, rahul));
    expect(text).toBe("Hello Rahul Verma from Shahdara, born 8 Nov");
    expect(parameters).toEqual(["Rahul Verma", "Shahdara", "8 Nov"]);
  });

  test("missing contact details fall back", () => {
    const fills: VariableFill[] = [
      { variable: "name", source: "first_name", fallback: "there" },
      { variable: "message", source: "email", fallback: "your inbox" },
    ];
    const values = personalValues(fills, shared, { externalId: "919800000000" });
    expect(values.name).toBe("there");
    expect(values.message).toBe("your inbox");
  });

  test("phone falls back to the WhatsApp number", () => {
    const values = personalValues([{ variable: "name", source: "phone", fallback: "x" }], shared, rahul);
    expect(values.name).toBe("+919812345678");
  });

  test("problems name the blank by number", () => {
    const body = "{{name}} {{venue}} {{message}}";
    const problems = fillProblems(body, [
      { variable: "name", source: "first_name", fallback: "" },
      { variable: "venue", source: "text", text: " " },
      { variable: "message", source: "attribute", fallback: "x" },
    ]);
    expect(problems).toEqual([
      "Give {{1}} a word to use when a contact has nothing saved.",
      "Write the text for {{2}}.",
      "Pick the contact field for {{3}}.",
    ]);
  });

  test("cleaning drops unused blanks and stray fields", () => {
    const cleaned = cleanFills("Hi {{name}}", [
      { variable: "name", source: "business", fallback: "x", text: "y" },
      { variable: "venue", source: "text", text: "Mall" },
    ]);
    expect(cleaned).toEqual([{ variable: "name", source: "business" }]);
  });
});
