export type NewId = () => string;

export const defaultNewId: NewId = () => globalThis.crypto.randomUUID();

export interface EditOptions {
  newId?: NewId;
}
