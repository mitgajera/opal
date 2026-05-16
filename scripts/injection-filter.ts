export interface InjectionCheckResult {
  flagged: boolean;
  reasons: string[];
}

type Rule = { name: string; test: (text: string) => boolean };

const RULES: Rule[] = [
  {
    name: "role_override",
    test: (t) =>
      /ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?/i.test(t) ||
      /(?:you\s+are|act\s+as|pretend\s+(?:to\s+be|you\s+are))\s+(?:a\s+)?(?:helpful|different|new)/i.test(t),
  },
  {
    name: "system_prompt_injection",
    test: (t) =>
      /\[SYSTEM\]/i.test(t) ||
      /<\/?system>/i.test(t) ||
      /###\s*system/i.test(t) ||
      /<<SYS>>/i.test(t),
  },
  {
    name: "verdict_override",
    test: (t) =>
      /(?:output|return|respond\s+with|answer\s+(?:must\s+be|is|should\s+be))\s*:?\s*(?:true|false|too.?early|unresolvable)/i.test(t) ||
      /"verdict"\s*:\s*"(?:TRUE|FALSE|TOO_EARLY|UNRESOLVABLE)"/i.test(t),
  },
  {
    name: "xml_escape",
    test: (t) =>
      /<\/(?:claim|auxiliary)>/i.test(t) ||
      /<(?:claim|auxiliary)>/i.test(t),
  },
  {
    name: "jailbreak",
    test: (t) =>
      /DAN\s+mode/i.test(t) ||
      /developer\s+mode\s+enabled/i.test(t) ||
      /jailbreak/i.test(t) ||
      /do\s+anything\s+now/i.test(t),
  },
  {
    name: "confidence_override",
    test: (t) =>
      /"confidence"\s*:\s*(?:0\.99|1\.0|1)/i.test(t) ||
      /set\s+(?:your\s+)?confidence\s+to/i.test(t),
  },
  {
    name: "excessive_length",
    test: (t) => t.length > 4_000,
  },
];

export function checkInjection(
  statement: string,
  auxiliaryData: string
): InjectionCheckResult {
  const combined = `${statement}\n${auxiliaryData}`;
  const reasons: string[] = [];

  for (const rule of RULES) {
    if (rule.test(combined)) {
      reasons.push(rule.name);
    }
  }

  return { flagged: reasons.length > 0, reasons };
}

export function assertCleanClaim(statement: string, auxiliaryData: string): void {
  const result = checkInjection(statement, auxiliaryData);
  if (result.flagged) {
    throw new Error(
      `Claim failed injection filter — triggered rules: ${result.reasons.join(", ")}`
    );
  }
}

if (import.meta.main) {
  const [, , statement = "", auxiliaryData = ""] = process.argv;
  const result = checkInjection(statement, auxiliaryData);
  if (result.flagged) {
    console.error("FLAGGED — rules triggered:", result.reasons.join(", "));
    process.exit(1);
  } else {
    console.log("OK — no injection patterns detected.");
  }
}
