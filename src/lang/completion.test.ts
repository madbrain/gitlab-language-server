import { describe, expect, test } from "vitest";
import { ConsoleErrorReporter } from "./console-error-reporter";
import { GenericTextDocument } from "./text-document";
import { DefaultIncludeResolver, GitlabService } from "./gitlabci";
import { CompletionPositioner } from "./completion-positioner";
import { CompletionItem } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

function code(text: string) {
  const offset = text.indexOf("@");
  return {
    text: text.substring(0, offset) + text.substring(offset + 1),
    offset,
  };
}

async function testComplete(
  content: string,
  expectedCompletions: CompletionItem[],
) {
  const logConsole = { log: console.log };
  const reporter = new ConsoleErrorReporter();
  const includeResolver = new DefaultIncludeResolver(logConsole);
  includeResolver.setWorkspaces(["./test"]);
  const gitlabService = new GitlabService(includeResolver);

  const { text, offset } = code(content);

  const gitlabFileContext = await gitlabService.validateDocument(
    "file:test.yml",
    text,
    reporter,
  );
  expect(gitlabFileContext).is.not.null;
  expect(gitlabFileContext?.root).is.not.null;

  const textDocument = new GenericTextDocument(text);
  const completionPosition = new CompletionPositioner(
    textDocument,
  ).findAtPosition(gitlabFileContext?.root!, offset);

  if (gitlabFileContext && completionPosition) {
    const completions = gitlabFileContext.mainFile.completeAt({
      document: {} as TextDocument,
      context: gitlabFileContext,
      position: completionPosition,
    });
    expect(completions).is.toEqual(expectedCompletions);
  } else {
    expect(false, "error while building");
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
