export class Range {
  static NULL = new Range(-1, -1);
  constructor(
    public start: number,
    public end: number,
  ) {}

  merge(other: Range | undefined) {
    if (!other) {
      return this;
    }
    return new Range(
      this.start < 0
        ? other.start
        : other.start < 0
          ? this.start
          : Math.min(this.start, other.start),
      this.end < 0
        ? other.end
        : other.end < 0
          ? this.end
          : Math.max(this.end, other.end),
    );
  }

  mergeEnd(endOffset: number) {
    return new Range(this.start, Math.max(this.end, endOffset));
  }

  contains(offset: number) {
    return this.start <= offset && offset < this.end;
  }

  toString() {
    return `[${this.start}:${this.end}]`;
  }
}

export class AstNode {
  constructor(public range: Range) {}
}

export class ScalarNode extends AstNode {
  constructor(
    range: Range,
    public value: string,
  ) {
    super(range);
  }

  findClosestNode(offset: number, positionProvider: PositionProvider) {
    if (this.range.contains(offset)) {
      return { type: "in-scalar", scalar: this };
    }
    if (this.range.end === offset) {
      return { type: "end-scalar", scalar: this };
    }
    return null;
  }
}

export interface Position {
  line: number;
  column: number;
}

export interface PositionProvider {
  toPosition(offset: number): Position;
}

export class MapItem<T /*extends AstNode*/> {
  constructor(
    public keyNode: ScalarNode,
    public separatorOffset: number,
    public value: T,
  ) {}
}

export class MapNode extends AstNode {
  public items: MapItem<any>[] = [];
  public byName = new Map<string, MapItem<any>>();

  constructor() {
    super(Range.NULL);
  }

  addItem(item: MapItem<any>) {
    this.items.push(item);
    this.byName.set(item.keyNode.value, item);
    this.range = this.range
      .merge(item.keyNode.range)
      .mergeEnd(item.separatorOffset)
      .merge(item.value?.range);
  }
}

export class ListNode extends AstNode {
  constructor(
    range: Range,
    public elements: ScalarNode[],
  ) {
    super(range);
  }
}
