import {
  CST,
  isMap,
  isScalar,
  isSeq,
  Pair,
  ParsedNode,
  Scalar,
  YAMLMap,
} from "yaml";
import { ErrorReporter } from "./error-reporter";
import { makeItemRange, makeRange } from "./gitlab-builder";
import {
  ListNode,
  ListTemplateNode,
  MapItem,
  Range,
  ScalarNode,
} from "./generic-model";
import { TemplateParser, TextTemplate } from "./template-parser";
import { ErrorExpr, Expression, ExpressionParser } from "./expression-parser";

export interface ListBuilder {
  minItems(count: number): ListBuilder;
  ofString(): MapItem<ListNode>;
  ofStringTemplate(): MapItem<ListTemplateNode>;
}

export interface MapBuilder {
  ofItemString<T>(
    fn: (name: ScalarNode, value: ScalarNode) => T,
  ): MapItem<T[]> | null;
  ofItemTemplate<T>(
    fn: (name: ScalarNode, value: TextTemplate) => T,
  ): MapItem<T[]> | null;
}

export class Builder implements ListBuilder {
  private hasError = false;
  private sourceRange!: Range;
  private defaultReportRange!: Range;
  private node: ParsedNode | null = null;
  private items: ParsedNode[] = [];
  private separatorOffset!: number;
  private keyNode!: ScalarNode;
  private isRequired = false;

  constructor(private reporter: ErrorReporter) {}

  fromItem(item: Pair<ParsedNode, ParsedNode | null>) {
    this.sourceRange = makeItemRange(item);
    this.defaultReportRange = makeRange(item.key);
    this.node = item.value;
    this.separatorOffset = findMapItemSeparator(item.srcToken!!.sep)!;
    this.keyNode = new ScalarNode(
      makeRange(item.key),
      (item.key as Scalar).value as string,
    );
    return this;
  }

  required() {
    this.isRequired = true;
    return this;
  }

  single(): MapItem<ScalarNode> | null {
    if (!this.hasError) {
      if (!isScalar(this.node)) {
        this.reporter.reportError(
          this.defaultReportRange,
          "expecting a scalar",
        );
      } else if (this.isRequired && !this.node.value) {
        this.reporter.reportError(this.defaultReportRange, "value is required");
      } else {
        return new MapItem(
          this.sourceRange,
          this.keyNode,
          this.separatorOffset,
          new ScalarNode(makeRange(this.node), this.node.value as string),
        );
      }
    }
    return null;
  }

  singleTemplate(): MapItem<TextTemplate> | null {
    if (!this.hasError) {
      if (!isScalar(this.node)) {
        this.reporter.reportError(
          this.defaultReportRange,
          "expecting a scalar",
        );
      } else if (this.isRequired && !this.node.value) {
        this.reporter.reportError(this.defaultReportRange, "value is required");
      } else {
        let range = makeRange(this.node);
        if (
          this.node.type === Scalar.QUOTE_SINGLE ||
          this.node.type === Scalar.QUOTE_DOUBLE
        ) {
          range = range.shrink(1);
        }
        return new MapItem(
          this.sourceRange,
          this.keyNode,
          this.separatorOffset,
          new TemplateParser(
            this.node.value as string,
            range,
            this.reporter,
          ).parse(),
        );
      }
    }
    return null;
  }

  singleExpression(): MapItem<Expression> | null {
    if (!this.hasError) {
      if (!isScalar(this.node)) {
        this.reporter.reportError(
          this.defaultReportRange,
          "expecting a scalar",
        );
      } else if (this.isRequired && !this.node.value) {
        this.reporter.reportError(this.defaultReportRange, "value is required");
      } else {
        let range = makeRange(this.node);
        if (
          this.node.type === Scalar.QUOTE_SINGLE ||
          this.node.type === Scalar.QUOTE_DOUBLE
        ) {
          range = range.shrink(1);
        }
        return new MapItem(
          this.sourceRange,
          this.keyNode,
          this.separatorOffset,
          new ExpressionParser(
            this.node.value as string,
            range,
            this.reporter,
          ).parse(),
        );
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

  ofString(): MapItem<ListNode> {
    const elements: ScalarNode[] = [];
    this.items.forEach((item) => {
      if (isScalar(item)) {
        elements.push(new ScalarNode(makeRange(item), item.value as string));
      } else {
        this.reporter.reportError(makeRange(item), "expecting a scalar");
      }
    });
    return new MapItem(
      makeRange(this.node!),
      this.keyNode,
      this.separatorOffset,
      new ListNode(makeRange(this.node!!), elements),
    );
  }

  ofStringTemplate(): MapItem<ListTemplateNode> {
    const elements: TextTemplate[] = [];
    this.items.forEach((item) => {
      if (isScalar(item)) {
        elements.push(
          new TemplateParser(
            item.value as string,
            makeRange(item),
            this.reporter,
          ).parse(),
        );
      } else {
        this.reporter.reportError(
          makeRange(item),
          "expecting a template scalar",
        );
      }
    });
    return new MapItem(
      makeRange(this.node!),
      this.keyNode,
      this.separatorOffset,
      new ListTemplateNode(makeRange(this.node!!), elements),
    );
  }

  map(): MapBuilder {
    if (!this.hasError) {
      if (!isMap(this.node)) {
        this.reporter.reportError(this.defaultReportRange, "expecting a map");
        this.hasError = true;
      }
    }
    return this;
  }

  ofItemString<T>(
    fn: (name: ScalarNode, value: ScalarNode) => T,
  ): MapItem<T[]> | null {
    const m = this.node as YAMLMap<ParsedNode, ParsedNode | null>;
    const elements: T[] = [];
    m.items.forEach((item) => {
      if (isScalar(item.key) && isScalar(item.value)) {
        elements.push(
          fn(
            new ScalarNode(makeRange(item.key), item.key.value as string),
            new ScalarNode(makeRange(item.value), item.value.value as string),
          ),
        );
      }
    });
    return new MapItem(
      this.sourceRange,
      this.keyNode,
      this.separatorOffset,
      elements,
    );
  }

  ofItemTemplate<T>(
    fn: (name: ScalarNode, value: TextTemplate) => T,
  ): MapItem<T[]> | null {
    const m = this.node as YAMLMap<ParsedNode, ParsedNode | null>;
    const elements: T[] = [];
    m.items.forEach((item) => {
      if (isScalar(item.key) && isScalar(item.value)) {
        elements.push(
          fn(
            new ScalarNode(makeRange(item.key), item.key.value as string),
            new TemplateParser(
              item.value.value as string,
              makeRange(item.value),
              this.reporter,
            ).parse(),
          ),
        );
      }
    });
    return new MapItem(
      makeRange(this.node!),
      this.keyNode,
      this.separatorOffset,
      elements,
    );
  }
}

export function findMapItemSeparator(sep: CST.SourceToken[] | undefined) {
  if (sep) {
    return sep.find((t) => t.type === "map-value-ind")?.offset;
  }
  return undefined;
}
