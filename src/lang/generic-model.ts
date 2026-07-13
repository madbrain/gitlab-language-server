export class Range {
  constructor(
    public start: number,
    public end: number,
  ) {}

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
}

export class ListNode extends AstNode {
  constructor(
    range: Range,
    public elements: ScalarNode[],
  ) {
    super(range);
  }
}
