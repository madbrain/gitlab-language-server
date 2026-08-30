import { ErrorReporter } from "./error-reporter";
import { Range } from "./generic-model";

enum TokenKind {
  VARIABLE = "VARIABLE",
  PATTERN = "PATTERN",
  IDENTIFIER = "IDENTIFIER",
  STRING_LITERAL = "STRING_LITERAL",
  NULL_LITERAL = "NULL_LITERAL",
  TRUE_LITERAL = "TRUE_LITERAL",
  FALSE_LITERAL = "FALSE_LITERAL",

  LPAR = "LPAR",
  RPAR = "RPAR",
  EQUALS = "EQUALS",
  NOT_EQUALS = "NOT_EQUALS",
  MATCHES = "MATCHES",
  NOT_MATCHES = "NOT_MATCHES",
  AND = "AND",
  OR = "OR",
  NOT = "NOT",

  START_INPUT = "START_INPUT",
  END_INPUT = "END_INPUT",
  DOT = "DOT",

  EOF = "EOF",
}

function tokenDisplay(kind: TokenKind) {
  switch (kind) {
    case TokenKind.VARIABLE:
      return "Variable";
    case TokenKind.PATTERN:
      return "Pattern";
    case TokenKind.IDENTIFIER:
      return "Identifier";
    case TokenKind.STRING_LITERAL:
      return "String Literal";
    case TokenKind.NULL_LITERAL:
      return "null";
    case TokenKind.TRUE_LITERAL:
      return "true";
    case TokenKind.FALSE_LITERAL:
      return "false";
    case TokenKind.LPAR:
      return "'('";
    case TokenKind.RPAR:
      return "')'";
    case TokenKind.EQUALS:
      return "'=='";
    case TokenKind.NOT_EQUALS:
      return "'!='";
    case TokenKind.MATCHES:
      return "'=~'";
    case TokenKind.NOT_MATCHES:
      return "'!~'";
    case TokenKind.AND:
      return "'&&'";
    case TokenKind.OR:
      return "'||'";
    case TokenKind.NOT:
      return "'!'";
    case TokenKind.START_INPUT:
      return "'$[['";
    case TokenKind.END_INPUT:
      return "']]'";
    case TokenKind.DOT:
      return "'.'";
  }
}

class Token {
  constructor(
    public kind: TokenKind,
    public range: Range,
    public value: string | null = null,
  ) {}
}

enum LexerState {
  NORMAL,
  INPUT,
}

class ExpressionLexer {
  private tokenStart = 0;
  private index = 0;
  private errorRange: Range | null = null;
  private state = LexerState.NORMAL;
  constructor(
    private content: string,
    private range: Range,
    private reporter: ErrorReporter,
  ) {}

  nextToken() {
    while (true) {
      this.tokenStart = this.range.start + this.index;
      const c = this.getChar();
      if (c === "\0") {
        return this.token(TokenKind.EOF);
      }
      if (this.state == LexerState.INPUT) {
        if (c === ".") {
          return this.token(TokenKind.DOT);
        }
        if (c === "]") {
          const cc = this.getChar();
          if (cc === "]") {
            this.state = LexerState.NORMAL;
            return this.token(TokenKind.END_INPUT);
          }
          this.ungetChar(cc);
        }
        if (this.isIdentStart(c)) {
          return this.scanIdentifier(c);
        }
        if (this.isSpace(c)) {
          continue;
        }
        this.markAsError();
        continue;
      }
      if (c === "(") {
        return this.token(TokenKind.LPAR);
      }
      if (c === ")") {
        return this.token(TokenKind.RPAR);
      }
      if (c === "=") {
        const cc = this.getChar();
        if (cc == "=") {
          return this.token(TokenKind.EQUALS);
        }
        if (cc == "~") {
          return this.token(TokenKind.MATCHES);
        }
        this.ungetChar(cc);
        this.markAsError();
        continue;
      }
      if (c === "!") {
        const cc = this.getChar();
        if (cc == "=") {
          return this.token(TokenKind.NOT_EQUALS);
        }
        if (cc == "~") {
          return this.token(TokenKind.NOT_MATCHES);
        }
        this.ungetChar(cc);
        return this.token(TokenKind.NOT);
      }
      if (c === "&") {
        const cc = this.getChar();
        if (cc == "&") {
          return this.token(TokenKind.AND);
        }
        this.ungetChar(cc);
        this.markAsError();
        continue;
      }
      if (c === "|") {
        const cc = this.getChar();
        if (cc == "|") {
          return this.token(TokenKind.OR);
        }
        this.ungetChar(cc);
        this.markAsError();
        continue;
      }

      if (c === "/") {
        return this.scanPattern();
      }

      if (c == "$") {
        const cc = this.getChar();
        if (cc === "[") {
          const ccc = this.getChar();
          if (ccc === "[") {
            this.state = LexerState.INPUT;
            return this.token(TokenKind.START_INPUT);
          }
          this.ungetChar(ccc);
        }
        if (this.isIdentPart(cc)) {
          return this.scanVariable(cc);
        }
        this.markAsError();
        continue;
      }
      if (c == '"' || c == "'") {
        return this.scanStringLiteral(c);
      }
      if (this.isIdentStart(c)) {
        const ident = this.scanIdentifier(c);
        if (ident.value == "null") {
          return this.token(TokenKind.NULL_LITERAL);
        }
        if (ident.value == "true") {
          return this.token(TokenKind.TRUE_LITERAL);
        }
        if (ident.value == "false") {
          return this.token(TokenKind.FALSE_LITERAL);
        }
        this.reporter.reportError(this.tokenRange(), "unknown literal");
        continue;
      }
      if (this.isSpace(c)) {
        continue;
      }
      this.markAsError();
    }
  }

  private scanStringLiteral(delimiter: string): Token {
    let content = "";
    while (true) {
      const c = this.getChar();
      if (c == "\0" || c == delimiter) {
        if (c == "\0") {
          this.reporter.reportError(this.tokenRange(), "unterminated string");
        }
        break;
      }
      content += c;
    }
    return this.token(TokenKind.STRING_LITERAL, content);
  }

  private scanVariable(c: string) {
    let name = c;
    while (true) {
      c = this.getChar();
      if (c == "\0" || !this.isIdentPart(c)) {
        this.ungetChar(c);
        break;
      }
      name += c;
    }
    return this.token(TokenKind.VARIABLE, name);
  }

  private scanIdentifier(c: string) {
    let name = c;
    while (true) {
      c = this.getChar();
      if (c == "\0" || !this.isIdentPart(c)) {
        this.ungetChar(c);
        break;
      }
      name += c;
    }
    return this.token(TokenKind.IDENTIFIER, name);
  }

  private scanPattern() {
    // /([^/]|\\/)+[^\\]\/[ismU]* -> pattern
    let pattern = "";
    let c;
    while (true) {
      c = this.getChar();
      if (c == "\0" || c === "/") {
        break;
      }
      if (c == "\\") {
        c = this.getChar();
      }
      pattern += c;
    }
    if (c == "/") {
      while (true) {
        c = this.getChar();
        if (c != "i" && c != "s" && c != "m" && c != "U") {
          this.ungetChar(c);
          break;
        }
      }
    }
    return this.token(TokenKind.PATTERN, pattern);
  }

  private markAsError() {
    if (!this.errorRange) {
      this.errorRange = this.tokenRange();
    } else {
      this.errorRange = this.errorRange.merge(this.tokenRange());
    }
  }

  private token(kind: TokenKind, value: string | null = null) {
    if (this.errorRange) {
      this.reporter.reportError(this.errorRange, "invalid characters");
      this.errorRange = null;
    }
    return new Token(kind, this.tokenRange(), value);
  }

  private isIdentStart(c: string) {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c == "_";
  }

  private isIdentPart(c: string) {
    return this.isIdentStart(c) || (c >= "0" && c <= "9");
  }

  private isSpace(c: string) {
    return c == " " || c == "\t";
  }

  private tokenRange(): Range {
    return new Range(this.tokenStart, this.range.start + this.index);
  }

  private getChar() {
    if (this.index >= this.content.length) {
      return "\0";
    }
    return this.content[this.index++];
  }

  private ungetChar(c: string) {
    if (c !== "\0") {
      this.index--;
    }
  }
}

export interface Expression {
  range: Range;
}
export class VariableExpr implements Expression {
  constructor(
    public range: Range,
    public name: string,
  ) {}
}
export class PatternExpr implements Expression {
  constructor(
    public range: Range,
    public value: string,
  ) {}
}
export class StringLiteralExpr implements Expression {
  constructor(
    public range: Range,
    public value: string,
  ) {}
}
export class NullLiteralExpr implements Expression {
  constructor(public range: Range) {}
}
export class FalseLiteralExpr implements Expression {
  constructor(public range: Range) {}
}

export class TrueLiteralExpr implements Expression {
  constructor(public range: Range) {}
}
export class Identifier {
  constructor(
    public range: Range,
    public name: string,
  ) {}
}
export class InputExpr implements Expression {
  constructor(
    public range: Range,
    public name: Identifier,
  ) {}
}
export class ErrorExpr implements Expression {
  constructor(public range: Range) {}
}
export enum Operation {
  EQUALS = "EQUALS",
  NOT_EQUALS = "NOT_EQUALS",
  MATCHES = "MATCHES",
  NOT_MATCHES = "NOT_MATCHES",
  OR = "OR",
  AND = "AND",
  NOT = "NOT",
}
export class BinaryOperation implements Expression {
  constructor(
    public range: Range,
    public operation: Operation,
    public left: Expression,
    public right: Expression,
  ) {}
}
export class UnaryOperation implements Expression {
  constructor(
    public range: Range,
    public operation: Operation,
    public expr: Expression,
  ) {}
}

class ParseError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class ExpressionParser {
  private lexer: ExpressionLexer;
  private token!: Token;
  constructor(
    content: string,
    private range: Range,
    private reporter: ErrorReporter,
  ) {
    this.lexer = new ExpressionLexer(content, range, reporter);
    this.scanToken();
  }

  parse() {
    try {
      const expr = this.parseExpr();
      if (this.token.kind != TokenKind.EOF) {
        this.reporter.reportError(
          this.token.range,
          "expecting end of expression",
        );
      }
      return expr;
    } catch (e: any) {
      if (!(e instanceof ParseError)) {
        this.reporter.reportError(
          this.token.range,
          `invalid expression: ${e.message}`,
        );
      }
      return new ErrorExpr(this.range);
    }
  }

  private parseExpr(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let expr = this.parseAnd();
    while (this.token.kind === TokenKind.OR) {
      this.scanToken();
      const right = this.parseAnd();
      expr = new BinaryOperation(
        expr.range.merge(right.range),
        Operation.OR,
        expr,
        right,
      );
    }
    return expr;
  }

  private parseAnd(): Expression {
    let expr = this.parseRelational();
    while (this.token.kind === TokenKind.AND) {
      this.scanToken();
      const right = this.parseRelational();
      expr = new BinaryOperation(
        expr.range.merge(right.range),
        Operation.AND,
        expr,
        right,
      );
    }
    return expr;
  }

  private parseRelational(): Expression {
    const expr = this.parseUnary();
    if (this.token.kind === TokenKind.EQUALS) {
      this.scanToken();
      const right = this.parseUnary();
      return new BinaryOperation(
        expr.range.merge(right.range),
        Operation.EQUALS,
        expr,
        right,
      );
    }
    if (this.token.kind === TokenKind.NOT_EQUALS) {
      this.scanToken();
      const right = this.parseUnary();
      return new BinaryOperation(
        expr.range.merge(right.range),
        Operation.NOT_EQUALS,
        expr,
        right,
      );
    }
    if (this.token.kind === TokenKind.MATCHES) {
      this.scanToken();
      const right = this.parseUnary();
      return new BinaryOperation(
        expr.range.merge(right.range),
        Operation.MATCHES,
        expr,
        right,
      );
    }
    if (this.token.kind === TokenKind.NOT_MATCHES) {
      this.scanToken();
      const right = this.parseUnary();
      return new BinaryOperation(
        expr.range.merge(right.range),
        Operation.NOT_MATCHES,
        expr,
        right,
      );
    }
    return expr;
  }

  private parseUnary(): Expression {
    if (this.token.kind === TokenKind.NOT) {
      this.scanToken();
      const expr = this.parseAtom();
      return new UnaryOperation(expr.range, Operation.NOT, expr);
    }
    return this.parseAtom();
  }

  private parseAtom(): Expression {
    if (this.token.kind === TokenKind.VARIABLE) {
      const expr = new VariableExpr(this.token.range, this.token.value!);
      this.scanToken();
      return expr;
    }
    if (this.token.kind === TokenKind.PATTERN) {
      const expr = new PatternExpr(this.token.range, this.token.value!);
      this.scanToken();
      return expr;
    }
    if (this.token.kind === TokenKind.STRING_LITERAL) {
      const expr = new StringLiteralExpr(this.token.range, this.token.value!);
      this.scanToken();
      return expr;
    }
    if (this.token.kind === TokenKind.NULL_LITERAL) {
      const expr = new NullLiteralExpr(this.token.range);
      this.scanToken();
      return expr;
    }
    if (this.token.kind === TokenKind.TRUE_LITERAL) {
      const expr = new TrueLiteralExpr(this.token.range);
      this.scanToken();
      return expr;
    }
    if (this.token.kind === TokenKind.FALSE_LITERAL) {
      const expr = new FalseLiteralExpr(this.token.range);
      this.scanToken();
      return expr;
    }
    if (this.token.kind === TokenKind.LPAR) {
      this.scanToken();
      const expr = this.parseExpr();
      this.expect(TokenKind.RPAR);
      return expr;
    }
    if (this.token.kind === TokenKind.START_INPUT) {
      const startRange = this.token.range;
      this.scanToken();
      return this.parseInput(startRange);
    }
    this.reporter.reportError(this.token.range, "expecting expression atom");
    const expr = new ErrorExpr(this.token.range);
    // TODO handle better panic mode with sync tokens
    this.scanToken();
    return expr;
  }

  private parseInput(startRange: Range): Expression {
    const inputsToken = this.expect(TokenKind.IDENTIFIER);
    if (inputsToken.value !== "inputs") {
      this.reporter.reportError(inputsToken.range, "expecting inputs");
    }
    this.expect(TokenKind.DOT);
    const inputName = this.expect(TokenKind.IDENTIFIER);
    const endRange = this.expect(TokenKind.END_INPUT).range;
    return new InputExpr(
      startRange.merge(endRange),
      new Identifier(inputName.range, inputName.value!),
    );
  }

  private expect(kind: TokenKind) {
    if (this.token.kind !== kind) {
      this.reporter.reportError(
        this.token.range,
        `expecting ${tokenDisplay(kind)}`,
      );
      throw new ParseError(
        `expecting ${tokenDisplay(kind)}, got ${tokenDisplay(this.token.kind)}`,
      );
    }
    const t = this.token;
    this.scanToken();
    return t;
  }

  private scanToken() {
    this.token = this.lexer.nextToken();
    return this.token;
  }
}
