// The default branch of an exhaustive switch: a new union member is a compile error there.
export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
}
