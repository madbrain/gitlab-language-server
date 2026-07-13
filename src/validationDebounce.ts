import { TextDocument } from "vscode-languageserver-textdocument";

export class ValidationDebouncer {
  private pendingValidationRequests: { [key: string]: NodeJS.Timeout } = {};

  constructor(
    private validationDelayMs: number,
    private handler: (textDocument: TextDocument) => void,
  ) {}

  validate(textDocument: TextDocument): void {
    this.cleanPendingValidation(textDocument);
    this.pendingValidationRequests[textDocument.uri] = setTimeout(() => {
      delete this.pendingValidationRequests[textDocument.uri];
      this.handler(textDocument);
    }, this.validationDelayMs);
  }

  cleanPendingValidation(textDocument: TextDocument): void {
    const request = this.pendingValidationRequests[textDocument.uri];
    if (request) {
      clearTimeout(request);
      delete this.pendingValidationRequests[textDocument.uri];
    }
  }
}
