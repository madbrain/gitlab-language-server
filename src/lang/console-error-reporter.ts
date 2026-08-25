import { ErrorReporter } from "./error-reporter";
import { Range } from "./generic-model";

export class ConsoleErrorReporter implements ErrorReporter {
  errors: {
    type: "warning" | "error";
    range: Range;
    message: string;
  }[] = [];

  reportError(range: Range, message: string): void {
    this.errors.push({ type: "error", range, message });
  }

  reportWarning(range: Range, message: string): void {
    this.errors.push({ type: "warning", range, message });
  }

  hasError() {
    return this.errors.some((error) => error.type === "error");
  }

  displayErrors(text: string) {
    let index = 0;
    let startOfLine = 0;
    while (index < text.length) {
      if (text[index++] == "\n") {
        this.displayErrorsAtLine(
          text.substring(startOfLine, index - 1),
          startOfLine,
        );
        startOfLine = index;
      }
    }
    if (startOfLine < index) {
      this.displayErrorsAtLine(text.substring(startOfLine, index), startOfLine);
    }
  }

  private displayErrorsAtLine(line: string, startOfLine: number) {
    this.errors
      .filter(
        (error) =>
          error.range.start >= startOfLine &&
          error.range.start < startOfLine + line.length,
      )
      .forEach((error) => {
        let spacer = "";
        for (let i = startOfLine; i < error.range.start; ++i) {
          spacer += " ";
        }
        let marker = "";
        for (let i = error.range.start; i < error.range.end; ++i) {
          marker += "^";
        }
        console.log(line);
        console.log(spacer + marker);
        console.log(`${error.type}${error.range}: ${error.message}`);
        console.log();
      });
  }
}
