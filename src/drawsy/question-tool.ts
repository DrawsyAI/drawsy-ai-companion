import { z } from "zod/v4";

export const QUESTION_TOOL_TIMEOUT_MS = 120_000;

const choice = z.object({
  label: z.string().trim().min(1).max(512),
  description: z.string().trim().max(2_000).optional()
});

export const questionToolInput = z.object({
  questions: z.array(z.object({
    question: z.string().trim().min(1).max(4_000),
    header: z.string().trim().max(128).optional(),
    options: z.array(choice).min(1).max(20)
      .refine((options) => new Set(options.map(({ label }) => label)).size === options.length, {
        message: "Option labels must be distinct."
      }).optional(),
    multiSelect: z.boolean().optional(),
    multiline: z.boolean().optional()
  })).min(1).max(10)
});

export type QuestionToolReply =
  | { answers: Record<string, string[]> }
  | { dismissed: true };
