import { describe, expect, it } from "vitest";
import {
  describeSkillOutcome,
  isLearnableOutcome,
  parseTurnOutcome,
  summarizeTurnEvidence,
} from "./outcome-judge.js";

describe("summarizeTurnEvidence", () => {
  it("renders the last turn only, with tool calls, results and error flags", () => {
    const evidence = summarizeTurnEvidence([
      { role: "user", content: "earlier request" },
      { role: "assistant", content: [{ type: "text", text: "earlier answer" }] },
      { role: "user", content: [{ type: "text", text: "deploy staging" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Running it." },
          { type: "toolCall", id: "c1", name: "exec", arguments: { command: "make deploy" } },
        ],
      },
      { role: "toolResult", toolCallId: "c1", toolName: "exec", isError: true, content: "exit 2" },
      { role: "assistant", content: [{ type: "text", text: "Done!" }] },
    ]);
    expect(evidence.text).not.toContain("earlier");
    expect(evidence.text).toBe(
      [
        "USER: deploy staging",
        "ASSISTANT: Running it.",
        'TOOL CALL exec {"command":"make deploy"}',
        "TOOL RESULT exec [ERROR]: exit 2",
        "ASSISTANT: Done!",
      ].join("\n"),
    );
    expect(evidence).toMatchObject({ toolCalls: 1, toolErrors: 1 });
  });

  it("keeps the request and the ending of an oversized turn", () => {
    const messages = [
      { role: "user", content: "the request" },
      ...Array.from({ length: 200 }, (_, index) => ({
        role: "toolResult",
        toolName: "read",
        content: `chunk ${index} ${"x".repeat(100)}`,
      })),
      { role: "assistant", content: "final answer" },
    ];
    const evidence = summarizeTurnEvidence(messages);
    expect(evidence.text.length).toBeLessThanOrEqual(6_100);
    expect(evidence.text.startsWith("USER: the request")).toBe(true);
    expect(evidence.text.endsWith("ASSISTANT: final answer")).toBe(true);
    expect(evidence.text).toContain("chars omitted");
  });
});

describe("parseTurnOutcome", () => {
  it("reads the judge's one-line JSON, even inside surrounding text", () => {
    expect(
      parseTurnOutcome(
        'Verdict: {"verdict":"success","evidence":"tests passed: 12/12","user_corrected":false}',
      ),
    ).toEqual({ verdict: "success", evidence: "tests passed: 12/12", userCorrected: false });
  });

  it.each(["", "not json", '{"verdict":"great"}', "[1]"])(
    "fails closed to unknown for %j",
    (raw) => {
      expect(parseTurnOutcome(raw).verdict).toBe("unknown");
    },
  );
});

describe("isLearnableOutcome", () => {
  it("learns from visible success, partial success, or a user correction only", () => {
    const base = { evidence: "e", userCorrected: false };
    expect(isLearnableOutcome({ ...base, verdict: "success" })).toBe(true);
    expect(isLearnableOutcome({ ...base, verdict: "partial" })).toBe(true);
    expect(isLearnableOutcome({ ...base, verdict: "failure" })).toBe(false);
    expect(isLearnableOutcome({ ...base, verdict: "unknown" })).toBe(false);
    expect(isLearnableOutcome({ ...base, verdict: "failure", userCorrected: true })).toBe(true);
  });
});

describe("describeSkillOutcome", () => {
  it("names recent failures and stays silent for a skill that never failed", () => {
    expect(describeSkillOutcome(undefined)).toBeUndefined();
    expect(
      describeSkillOutcome({ success: 4, failure: 0, recent: [true, true], updatedAtMs: 1 }),
    ).toBeUndefined();
    expect(
      describeSkillOutcome({
        success: 3,
        failure: 2,
        recent: [true, false, true, false, true],
        updatedAtMs: 1,
      }),
    ).toBe("failed 2 of last 5 uses");
  });
});
