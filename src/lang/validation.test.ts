import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ConsoleErrorReporter } from "./console-error-reporter";
import { DefaultIncludeResolver, GitlabService } from "./gitlabci";
import { URI } from "vscode-uri";

describe("Parse and convert", async () => {
  test("Should parse and validate Root GitlabCI", async () => {
    const workspaceRoot = resolve("../workspace/atomix");
    const text = readFileSync(workspaceRoot + "/.gitlab-ci.yml", "utf8");

    const reporter = new ConsoleErrorReporter();
    const logConsole = { log: console.log };
    const includeResolver = new DefaultIncludeResolver(logConsole);
    includeResolver.setWorkspaces([URI.file(workspaceRoot).toString()]);
    const gitlabService = new GitlabService(includeResolver);

    const result = await gitlabService.validateDocument(
      "file:test.yml",
      text,
      reporter,
    );
    reporter.displayErrors(text);
    expect(result).not.null;
  });

  test("Should parse and validate GitlabCI Component", async () => {
    const workspaceRoot = resolve("../workspace/atomix");
    const text = readFileSync(
      workspaceRoot +
        "/.gitlab-lsp/cache/projects/GNOME/citemplates/master/templates/release-service.yml",
      "utf8",
    );

    const reporter = new ConsoleErrorReporter();
    const logConsole = { log: console.log };
    const includeResolver = new DefaultIncludeResolver(logConsole);
    includeResolver.setWorkspaces([URI.file(workspaceRoot).toString()]);
    const gitlabService = new GitlabService(includeResolver);

    const result = await gitlabService.validateDocument(
      "file:.gitlab-lsp/cache/projects/GNOME/citemplates/master/templates/release-service.yml",
      text,
      reporter,
    );
    reporter.displayErrors(text);
    expect(result).not.null;
  });
});
