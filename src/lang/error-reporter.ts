import { Range } from "./generic-model";

export interface ErrorReporter {
  reportWarning(range: Range, message: string): void;
  reportError(range: Range, message: string): void;
}

export const NullReporter: ErrorReporter = {
  reportWarning(range: Range, message: string) {},
  reportError(range: Range, message: string) {},
};
