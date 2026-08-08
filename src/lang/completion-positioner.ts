import { isAlias, isMap, isScalar, isSeq, Scalar, type ParsedNode } from "yaml";
import { Position } from "./generic-model";
import { GenericTextDocument } from "./text-document";

function contains(range: number[], offset: number) {
  return range[0] <= offset && offset <= range[1];
}

export type PathElement =
  | { type: "field"; name: string }
  | { type: "item"; index: number };

export interface CompletionPosition {
  type:
    | "complete-in-scalar"
    | "complete-in-key"
    | "complete-key"
    | "complete-value"
    | "complete-in-alias";
  path: PathElement[];
}

export class CompletionPositioner {
  private position!: Position;
  private isWS!: boolean;
  constructor(private textDocument: GenericTextDocument) {}

  findAtPosition(node: ParsedNode, offset: number) {
    this.position = this.textDocument.toPosition(offset);
    this.isWS =
      this.textDocument.getLineBefore(this.position).trim().length == 0;
    return this.lookInto(node, offset, [], 0, -1);
  }

  private lookInto(
    node: ParsedNode,
    offset: number,
    path: PathElement[],
    minOffset: number,
    maxOffset: number,
  ): CompletionPosition | null {
    if (isScalar(node)) {
      const endPosition = this.textDocument.toPosition(node.range[1]);
      const endLine = endPosition.line;
      if (
        node.type === Scalar.BLOCK_LITERAL ||
        node.type === Scalar.BLOCK_FOLDED
      ) {
        if (contains(node.range, offset)) {
          return {
            type: "complete-in-scalar",
            path,
          };
        }
      } else if (
        contains(node.range, offset) ||
        endLine === this.position.line
      ) {
        return { type: "complete-in-scalar", path };
      }
    }

    if (isMap(node)) {
      const indent = node.srcToken!!.indent;
      const startLine = this.textDocument.toPosition(
        minOffset >= 0 ? minOffset : node.range[0],
      ).line; // TODO extend start when first
      const endLine = this.textDocument.toPosition(
        maxOffset >= 0 ? maxOffset : node.range[1],
      ).line;
      if (startLine <= this.position.line && this.position.line <= endLine) {
        for (const item of node.items) {
          const itemPath: PathElement[] = [
            ...path,
            { type: "field", name: item.key.toString() },
          ];
          if (contains(item.key.range, offset)) {
            return { type: "complete-in-key", path: itemPath };
          }
        }
        if (this.position.column == indent && this.isWS) {
          return { type: "complete-key", path: path };
        }
        let i = 0;
        while (i < node.items.length) {
          const item = node.items[i];
          const itemPath: PathElement[] = [
            ...path,
            { type: "field", name: item.key.toString() },
          ];
          if (item.value) {
            const itemMaxOffset =
              i < node.items.length - 1
                ? node.items[i + 1].key.range[0]
                : maxOffset;
            const result = this.lookInto(
              item.value,
              offset,
              itemPath,
              -1,
              itemMaxOffset,
            );
            if (result) {
              return result;
            }
            if (
              item.key.range[2] < offset &&
              offset < itemMaxOffset &&
              this.position.column > indent &&
              this.isWS
            ) {
              return { type: "complete-value", path: itemPath };
            }
          }
          ++i;
        }
        return null;
      }
    }
    if (isSeq(node)) {
      if (contains(node.range, offset)) {
        let index = 0;
        for (const item of node.items) {
          const itemPath: PathElement[] = [...path, { type: "item", index }];
          const itemMaxOffset =
            index < node.items.length - 1
              ? node.items[index + 1].range[0]
              : maxOffset;
          const result = this.lookInto(
            item,
            offset,
            itemPath,
            -1,
            itemMaxOffset,
          );
          if (result) {
            return result;
          }
          ++index;
        }
      }
    }
    if (isAlias(node)) {
      if (contains(node.range, offset)) {
        return { type: "complete-in-alias", path: path };
      }
    }
    return null;
  }
}
