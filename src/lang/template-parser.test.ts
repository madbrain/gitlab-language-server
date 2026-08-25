import { describe, expect, test } from "vitest";
import { Range } from "./generic-model";
import { TemplateParser, TextTemplate } from "./template-parser";
import { ConsoleErrorReporter } from "./console-error-reporter";

describe("TemplateParser", () => {
  test("should parse template", () => {
    const content =
      "${TARBALL_ARTIFACT_DIR}/${CI_PROJECT_NAME}-${CI_COMMIT_TAG}.tar.xz";
    const reporter = new ConsoleErrorReporter();
    const templateParser = new TemplateParser(
      content,
      new Range(10, 10 + content.length),
      reporter,
    );
    const template = templateParser.parse();
    expect(reporter.hasError()).is.false;
    expect(template).toEqual({
      range: new Range(10, 76),
      elements: [
        {
          type: "variable",
          range: new Range(10, 33),
          content: "${TARBALL_ARTIFACT_DIR}",
          name: "TARBALL_ARTIFACT_DIR",
        },
        {
          type: "text",
          range: new Range(33, 34),
          content: "/",
        },
        {
          type: "variable",
          range: new Range(34, 52),
          content: "${CI_PROJECT_NAME}",
          name: "CI_PROJECT_NAME",
        },
        {
          type: "text",
          range: new Range(52, 53),
          content: "-",
        },
        {
          type: "variable",
          range: new Range(53, 69),
          content: "${CI_COMMIT_TAG}",
          name: "CI_COMMIT_TAG",
        },
        {
          type: "text",
          range: new Range(69, 76),
          content: ".tar.xz",
        },
      ],
    });
  });

  test("should parse alternate template", () => {
    const content = "$TARBALL_ARTIFACT_DIR-%CI_PROJECT_NAME%";
    const reporter = new ConsoleErrorReporter();
    const templateParser = new TemplateParser(
      content,
      new Range(10, 10 + content.length),
      reporter,
    );
    const template = templateParser.parse();
    expect(reporter.hasError()).is.false;
    expect(template).toEqual({
      range: new Range(10, 49),
      elements: [
        {
          type: "variable",
          range: new Range(10, 31),
          content: "$TARBALL_ARTIFACT_DIR",
          name: "TARBALL_ARTIFACT_DIR",
        },
        {
          type: "text",
          range: new Range(31, 32),
          content: "-",
        },
        {
          type: "variable",
          range: new Range(32, 49),
          content: "%CI_PROJECT_NAME%",
          name: "CI_PROJECT_NAME",
        },
      ],
    });
  });

  test("should parse terminate in-name", () => {
    const content = "$TARBALL_ARTIFACT_DIR";
    const reporter = new ConsoleErrorReporter();
    const templateParser = new TemplateParser(
      content,
      new Range(10, 10 + content.length),
      reporter,
    );
    const template = templateParser.parse();
    expect(reporter.hasError()).is.false;
    expect(template).toEqual({
      range: new Range(10, 31),
      elements: [
        {
          type: "variable",
          range: new Range(10, 31),
          content: "$TARBALL_ARTIFACT_DIR",
          name: "TARBALL_ARTIFACT_DIR",
        },
      ],
    });
  });

  test("should parse escape", () => {
    const content = "$$TARBALL_ARTIFACT_DIR";
    const reporter = new ConsoleErrorReporter();
    const templateParser = new TemplateParser(
      content,
      new Range(10, 10 + content.length),
      reporter,
    );
    const template = templateParser.parse();
    expect(reporter.hasError()).is.false;
    expect(template).toEqual({
      range: new Range(10, 32),
      elements: [
        {
          type: "text",
          range: new Range(10, 32),
          content: "$$TARBALL_ARTIFACT_DIR",
        },
      ],
    });
  });
  test("should raise error", () => {
    const content = "$ TARBALL_ARTIFACT_DIR";
    const reporter = new ConsoleErrorReporter();
    const templateParser = new TemplateParser(
      content,
      new Range(10, 10 + content.length),
      reporter,
    );
    const template = templateParser.parse();
    expect(reporter.hasError()).is.true;
    expect(reporter.errors).toEqual([
      {
        message: "expecting '{' or ident start",
        range: new Range(11, 12),
        type: "error",
      },
    ]);
    expect(template).toEqual({
      range: new Range(10, 32),
      elements: [
        {
          type: "text",
          range: new Range(10, 32),
          content: "$ TARBALL_ARTIFACT_DIR",
        },
      ],
    });
  });

  test("should raise error on empty name", () => {
    const content = "${}";
    const reporter = new ConsoleErrorReporter();
    const templateParser = new TemplateParser(
      content,
      new Range(10, 10 + content.length),
      reporter,
    );
    const template = templateParser.parse();
    expect(reporter.hasError()).is.true;
    expect(reporter.errors).toEqual([
      {
        message: "empty variable name",
        range: new Range(10, 13),
        type: "error",
      },
    ]);
    expect(template).toEqual({
      range: new Range(10, 13),
      elements: [
        {
          type: "variable",
          range: new Range(10, 13),
          content: "${}",
          name: "",
        },
      ],
    });
  });

  test("should raise error on missing delimiter", () => {
    const content = "${HELLO";
    const reporter = new ConsoleErrorReporter();
    const templateParser = new TemplateParser(
      content,
      new Range(10, 10 + content.length),
      reporter,
    );
    const template = templateParser.parse();
    expect(reporter.hasError()).is.true;
    expect(reporter.errors).toEqual([
      {
        message: "expecting end delimiter",
        range: new Range(10, 17),
        type: "error",
      },
    ]);
    expect(template).toEqual({
      range: new Range(10, 17),
      elements: [
        {
          type: "variable",
          range: new Range(10, 17),
          content: "${HELLO",
          name: "HELLO",
        },
      ],
    });
  });
});
