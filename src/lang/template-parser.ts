import { Range } from "./generic-model";
import { ErrorReporter } from "./error-reporter";

export class TextTemplate {
  constructor(
    public range: Range,
    public elements: TemplateElement[],
  ) {}

  expandText(envs: { [name: string]: string }) {
    let value = "";
    this.elements.forEach((element) => {
      if (element.type === "text") {
        value += element.content;
      } else {
        const varValue = envs[element.name];
        if (varValue) {
          value += varValue;
        } else {
          // keep original text
          value += element.content;
        }
      }
    });
    return value;
  }
}

export type TemplateElement =
  | { type: "text"; range: Range; content: string }
  | { type: "variable"; range: Range; content: string; name: string };

type State = "in-text" | "found-dollar" | "enclosed-var" | "in-name";

/* Gitlab text template with variables
 * - syntax: $variable, or ${variable} or %variable%
 *   - https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/gitlab/ci/variables/collection/item.rb?ref_type=heads
 *   - VARIABLES_REGEXP = /\$\$|%%|\$(?<key>[a-zA-Z_][a-zA-Z0-9_]*)|\${\g<key>?}|%\g<key>%/
 * - References to unavailable variables are left intact
 * - variable dependencies as to topologically sortable
 * - expansion are done is this order only once per variable, no recursion until convergence
 * https://docs.gitlab.com/ci/variables/where_variables_can_be_used/#gitlab-internal-variable-expansion-mechanism
 */
export class TemplateParser {
  private index = 0;
  constructor(
    private content: string,
    private range: Range,
    private reporter: ErrorReporter,
  ) {}

  parse(): TextTemplate {
    const elements: TemplateElement[] = [];
    let start = this.index;
    let nameStart = this.index;
    let state: State = "in-text";
    let delimiter: string | null = null;
    const endText = (index: number) => {
      if (start != index) {
        elements.push({
          type: "text",
          range: new Range(this.range.start + start, this.range.start + index),
          content: this.content.slice(start, index),
        });
      }
    };
    while (true) {
      const c =
        this.index < this.content.length ? this.content[this.index] : "";
      if (state == "in-text") {
        if (c == "$") {
          endText(this.index);
          start = this.index;
          state = "found-dollar";
          ++this.index;
        } else if (c == "%") {
          endText(this.index);
          start = this.index;
          state = "enclosed-var";
          delimiter = "%";
          ++this.index;
          nameStart = this.index;
        } else if (c == "") {
          endText(this.index);
          break;
        } else {
          ++this.index;
        }
      } else if (state == "found-dollar") {
        if (c == "{") {
          state = "enclosed-var";
          ++this.index;
          nameStart = this.index;
          delimiter = "}";
        } else if (c == "$") {
          state = "in-text";
          ++this.index;
        } else if (this.isNameStart(c)) {
          state = "in-name";
          nameStart = this.index;
          ++this.index;
        } else {
          // TODO maybe don't report any error
          this.reporter.reportError(
            new Range(
              this.range.start + this.index,
              this.range.start + this.index + 1,
            ),
            "expecting '{' or ident start",
          );
          state = "in-text";
          ++this.index;
        }
      } else if (state == "enclosed-var") {
        if (c == delimiter) {
          ++this.index;
          elements.push({
            type: "variable",
            range: new Range(
              this.range.start + start,
              this.range.start + this.index,
            ),
            content: this.content.slice(start, this.index),
            name: "",
          });
          this.reporter.reportError(
            new Range(this.range.start + start, this.range.start + this.index),
            "empty variable name",
          );
          state = "in-text";
          delimiter = null;
          start = this.index;
        } else if (this.isNameStart(c)) {
          state = "in-name";
          ++this.index;
        } else {
          ++this.index;
        }
      } else if (state == "in-name") {
        if (!this.isNamePart(c)) {
          let nameEnd = this.index;
          if (delimiter) {
            if (c != delimiter) {
              this.reporter.reportError(
                new Range(
                  this.range.start + start,
                  this.range.start + this.index,
                ),
                "expecting end delimiter",
              );
            } else {
              ++this.index;
            }
          }
          elements.push({
            type: "variable",
            range: new Range(
              this.range.start + start,
              this.range.start + this.index,
            ),
            content: this.content.slice(start, this.index),
            name: this.content.slice(nameStart, nameEnd),
          });
          state = "in-text";
          delimiter = null;
          start = this.index;
        } else {
          ++this.index;
        }
      } else {
        ++this.index;
      }
    }
    return new TextTemplate(this.range, elements);
  }

  private isNameStart(c: string) {
    return ("a" <= c && c <= "z") || ("A" <= c && c <= "Z") || c == "_";
  }

  private isNamePart(c: string) {
    return this.isNameStart(c) || ("0" <= c && c <= "9");
  }
}
