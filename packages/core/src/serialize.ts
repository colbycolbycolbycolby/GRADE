import { ProgramFileSchema, SCHEMA_VERSION, type Program } from '@grade/schema';
import { CoreError } from './errors';
import { checkProgram } from './invariants';

export function serializeProgram(program: Program): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, program }, null, 2);
}

/** Accepts JSON text or an already parsed value. Throws CoreError when the input is not valid. */
export function parseProgram(input: string | unknown): Program {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new CoreError('invalid_program', 'The file is not valid JSON');
    }
  }
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'schemaVersion' in raw &&
    (raw as { schemaVersion: unknown }).schemaVersion !== SCHEMA_VERSION
  ) {
    throw new CoreError('unsupported_version', 'This file uses an unsupported schema version');
  }
  const parsed = ProgramFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CoreError('invalid_program', parsed.error.issues.map((i) => i.message).join('; '));
  }
  const problems = checkProgram(parsed.data.program);
  if (problems.length > 0) throw new CoreError('invalid_program', problems.join('; '));
  return parsed.data.program;
}
