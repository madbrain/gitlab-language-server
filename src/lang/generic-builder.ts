import { isScalar, isSeq, Pair, ParsedNode } from "yaml";
import { ErrorReporter } from "./error-reporter";
import { makeRange } from "./gitlab-builder";
import { ListNode, Range, ScalarNode } from "./generic-model";

export interface ListBuilder {
  minItems(count: number): ListBuilder;
  ofString(): ListNode;
}

export class Builder implements ListBuilder {
  private hasError = false;
  private defaultReportRange!: Range;
  private node: ParsedNode | null = null;
  private items: ParsedNode[] = [];

  constructor(private reporter: ErrorReporter) {}

  fromItem(item: Pair<ParsedNode, ParsedNode | null>) {
    this.defaultReportRange = makeRange(item.key);
    this.node = item.value;
    return this;
  }

  required() {
    if (!this.hasError && !this.node) {
      this.reporter.reportError(this.defaultReportRange, "expecting a value");
      this.hasError = true;
    }
    return this;
  }

  single(): ScalarNode | null {
    if (!this.hasError) {
      if (!isScalar(this.node)) {
        this.reporter.reportError(this.defaultReportRange, "expecting a list");
        this.hasError = true;
      } else {
        return new ScalarNode(makeRange(this.node), this.node.value as string);
      }
    }
    return null;
  }

  singleToList(): ListBuilder {
    if (!this.hasError) {
      if (isScalar(this.node)) {
        this.items = [this.node!];
      } else {
        return this.list();
      }
    }
    return this;
  }

  list(): ListBuilder {
    if (!this.hasError) {
      if (!isSeq(this.node)) {
        this.reporter.reportError(this.defaultReportRange, "expecting a list");
        this.hasError = true;
      } else {
        this.items = this.node.items;
      }
    }
    return this;
  }

  minItems(count: number): ListBuilder {
    if (!this.hasError && this.items.length < count) {
      this.reporter.reportError(
        this.defaultReportRange,
        `expecting a minimum ${count} of item(s)`,
      );
      this.hasError = true;
    }
    return this;
  }

  ofString(): ListNode {
    const elements: ScalarNode[] = [];
    this.items.forEach((item) => {
      if (isScalar(item)) {
        elements.push(new ScalarNode(makeRange(item), item.value as string));
      } else {
        this.reporter.reportError(makeRange(item), "expecting a scalar");
      }
    });
    return new ListNode(makeRange(this.node!!), elements);
  }
}
