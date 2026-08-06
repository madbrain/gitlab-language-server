import { describe, expect, test } from "vitest";
import { ConsoleErrorReporter } from "./console-error-reporter";
import { GenericTextDocument } from "./text-document";
import { DefaultIncludeResolver, GitlabService } from "./gitlabci";
import { CompletionPositioner } from "./completion-positioner";
import { CompletionItem } from "vscode-languageserver";

function code(text: string) {
  const offset = text.indexOf("@");
  return {
    text: text.substring(0, offset) + text.substring(offset + 1),
    offset,
  };
}

function testComplete(content: string, expectedCompletions: CompletionItem[]) {
  const { text, offset } = code(content);
  const reporter = new ConsoleErrorReporter();
  const includeResolver = new DefaultIncludeResolver();
  const gitlabService = new GitlabService(includeResolver);
  const textDocument = new GenericTextDocument(text);

  const root = gitlabService.parseDocument(text, reporter);
  expect(root).is.not.null;
  if (root) {
    const completionPosition = new CompletionPositioner(
      textDocument,
    ).findAtPosition(root, offset);
    const gitlabFile = gitlabService.validateDocument(root, reporter);
    expect(reporter.hasError()).is.false;
    if (gitlabFile && completionPosition) {
      expect(
        gitlabFile.completeAt({
          file: gitlabFile,
          position: completionPosition,
        }),
      ).is.toEqual(expectedCompletions);
    } else {
      expect(false, "error while building");
    }
  }
}

describe("Complete GitlabCI file", () => {
  test("Should complete root keys", () => {
    const content = `
stages:
  - build
  - test
@
my_job:
  stage: build
`;

    testComplete(content, [
      {
        label: "default",
      },
      {
        label: "include",
      },
      {
        label: "variables",
      },
      {
        label: "workflow",
      },
    ]);
  });

  test("Should complete job keys", () => {
    const content = `
stages:
  - build
  - test

my_job:
  stage: @
`;

    testComplete(content, [
      {
        label: "build",
      },
      {
        label: "test",
      },
    ]);
  });

  test("Should complete job stage", () => {
    const content = `
stages:
  - build
  - test

my_job:
  stage: @
`;

    testComplete(content, [
      {
        label: "build",
      },
      {
        label: "test",
      },
    ]);
  });
});
