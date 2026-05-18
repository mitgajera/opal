import { OracleJob } from "@switchboard-xyz/common";
import { VERIFIER_PROMPT } from "./prompt.js";

const VERDICT_STRING_MAP = OracleJob.StringMapTask.fromObject({
  items: [
    { key: "TRUE", value: "0" },
    { key: "FALSE", value: "1" },
    { key: "TOO_EARLY", value: "2" },
    { key: "UNRESOLVABLE", value: "3" },
  ],
  defaultValue: "3",
});

export const GPT4O_JOB = OracleJob.fromObject({
  tasks: [
    {
      llmTask: {
        providerConfig: {
          openai: {
            model: "gpt-4o",
            temperature: 0,
            prompt: VERIFIER_PROMPT,
            secretNameApiKey: "OPENAI_API_KEY",
          },
        },
      },
    },
    {
      regexExtractTask: {
        pattern: '"verdict":\\s*"([A-Z_]+)"',
        groupNumber: 1,
      },
    },
    { stringMapTask: VERDICT_STRING_MAP },
  ],
});

const ANTHROPIC_REQUEST_BODY = JSON.stringify({
  model: "claude-opus-4-7",
  max_tokens: 512,
  temperature: 0,
  messages: [{ role: "user", content: VERIFIER_PROMPT }],
});

export const CLAUDE_JOB = OracleJob.fromObject({
  tasks: [
    {
      httpTask: {
        url: "https://api.anthropic.com/v1/messages",
        method: OracleJob.HttpTask.Method.METHOD_POST,
        headers: [
          { key: "content-type", value: "application/json" },
          { key: "anthropic-version", value: "2023-06-01" },
          { key: "x-api-key", value: "${ANTHROPIC_API_KEY}" },
        ],
        body: ANTHROPIC_REQUEST_BODY,
      },
    },
    { jsonParseTask: { path: "$.content[0].text" } },
    {
      regexExtractTask: {
        pattern: '"verdict":\\s*"([A-Z_]+)"',
        groupNumber: 1,
      },
    },
    { stringMapTask: VERDICT_STRING_MAP },
  ],
});

export const GEMINI_JOB = OracleJob.fromObject({
  tasks: [
    {
      llmTask: {
        providerConfig: {
          openai: {
            model: "gemini-3.1-pro-preview",
            temperature: 0,
            prompt: VERIFIER_PROMPT,
            baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
            secretNameApiKey: "GEMINI_API_KEY",
          },
        },
      },
    },
    {
      regexExtractTask: {
        pattern: '"verdict":\\s*"([A-Z_]+)"',
        groupNumber: 1,
      },
    },
    { stringMapTask: VERDICT_STRING_MAP },
  ],
});

export const COUNCIL_JOBS = [GPT4O_JOB, CLAUDE_JOB, GEMINI_JOB] as const;

export const COUNCIL_JOB_NAMES = [
  "Opal Council 0 — GPT-4o",
  "Opal Council 1 — Claude Opus 4.7",
  "Opal Council 2 — Gemini 3.1 Pro",
] as const;
