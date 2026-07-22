import type { Diagnostic } from "./types.js";

export class AgentGraphError extends Error {
  readonly code: string;
  readonly diagnostics: Diagnostic[];

  constructor(code: string, message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.name = "AgentGraphError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
