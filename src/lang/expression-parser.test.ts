import { describe, expect, test } from "vitest";
import {
  BinaryOperation,
  ErrorExpr,
  ExpressionParser,
  Identifier,
  InputExpr,
  NullLiteralExpr,
  Operation,
  PatternExpr,
  StringLiteralExpr,
  UnaryOperation,
  VariableExpr,
} from "./expression-parser";
import { Range } from "./generic-model";
import { ConsoleErrorReporter } from "./console-error-reporter";

// spec/lib/gitlab/ci/pipeline/expression/statement_spec.rb
describe("ExpressionParser", () => {
  test("should parse simple", () => {
    const content = `($PRESENT_VARUABLE =~ /^content.*/ || $PATH_VARIABLE =~ /value$/) && !$UNDEFINED_VARIABLE`;

    const reporter = new ConsoleErrorReporter();
    const parser = new ExpressionParser(
      content,
      new Range(0, content.length),
      reporter,
    );
    const result = parser.parse();

    expect(result).toEqual(
      new BinaryOperation(
        new Range(1, 89),
        Operation.AND,
        new BinaryOperation(
          new Range(1, 64),
          Operation.OR,
          new BinaryOperation(
            new Range(1, 34),
            Operation.MATCHES,
            new VariableExpr(new Range(1, 18), "PRESENT_VARUABLE"),
            new PatternExpr(new Range(22, 34), "^content.*"),
          ),
          new BinaryOperation(
            new Range(38, 64),
            Operation.MATCHES,
            new VariableExpr(new Range(38, 52), "PATH_VARIABLE"),
            new PatternExpr(new Range(56, 64), "value$"),
          ),
        ),
        new UnaryOperation(
          new Range(70, 89),
          Operation.NOT,
          new VariableExpr(new Range(70, 89), "UNDEFINED_VARIABLE"),
        ),
      ),
    );
  });

  test("should parse complex", () => {
    const content = `$PATH_VARIABLE == "null" || $PATH_VARIABLE == 'null' || $PATH_VARIABLE == null`;

    const reporter = new ConsoleErrorReporter();
    const parser = new ExpressionParser(
      content,
      new Range(0, content.length),
      reporter,
    );
    const result = parser.parse();

    reporter.displayErrors(content);

    expect(reporter.hasError()).toBeFalsy();
    expect(result).toEqual(
      new BinaryOperation(
        new Range(0, 78),
        Operation.OR,
        new BinaryOperation(
          new Range(0, 52),
          Operation.OR,
          new BinaryOperation(
            new Range(0, 24),
            Operation.EQUALS,
            new VariableExpr(new Range(0, 14), "PATH_VARIABLE"),
            new StringLiteralExpr(new Range(18, 24), "null"),
          ),
          new BinaryOperation(
            new Range(28, 52),
            Operation.EQUALS,
            new VariableExpr(new Range(28, 42), "PATH_VARIABLE"),
            new StringLiteralExpr(new Range(46, 52), "null"),
          ),
        ),
        new BinaryOperation(
          new Range(56, 78),
          Operation.EQUALS,
          new VariableExpr(new Range(56, 70), "PATH_VARIABLE"),
          new NullLiteralExpr(new Range(74, 78)),
        ),
      ),
    );
  });

  test("should parse invalid chars", () => {
    const content = `@VARIABLE`;

    const reporter = new ConsoleErrorReporter();
    const parser = new ExpressionParser(
      content,
      new Range(0, content.length),
      reporter,
    );
    const result = parser.parse();

    expect(reporter.hasError()).toBeTruthy();
    expect(reporter.errors[0]).toEqual({
      message: "invalid characters",
      range: new Range(0, 1),
      type: "error",
    });

    expect(result).toEqual(new ErrorExpr(new Range(9, 9)));
  });

  test("should parse input", () => {
    const content = `$[[ inputs.hello ]] == 'world'`;

    const reporter = new ConsoleErrorReporter();
    const parser = new ExpressionParser(
      content,
      new Range(0, content.length),
      reporter,
    );
    const result = parser.parse();

    expect(reporter.hasError()).toBeFalsy();
    expect(result).toEqual(
      new BinaryOperation(
        new Range(0, 30),
        Operation.EQUALS,
        new InputExpr(
          new Range(0, 19),
          new Identifier(new Range(11, 16), "hello"),
        ),
        new StringLiteralExpr(new Range(23, 30), "world"),
      ),
    );
  });
});
