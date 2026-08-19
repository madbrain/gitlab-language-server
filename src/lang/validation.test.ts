import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ConsoleErrorReporter } from "./console-error-reporter";
import { DefaultIncludeResolver, GitlabService } from "./gitlabci";
import { URI } from "vscode-uri";
import { VariablesProvider } from "./gitlab-validator";

describe("Parse and convert", async () => {
  test("Should parse and validate Root GitlabCI", async () => {
    const workspaceRoot = resolve("../workspace/atomix");
    const testFilename = workspaceRoot + "/.gitlab-ci.yml";
    const text = readFileSync(testFilename, "utf8");

    const reporter = new ConsoleErrorReporter();
    const logConsole = { log: console.log };
    const includeResolver = new DefaultIncludeResolver(logConsole);
    includeResolver.setWorkspaces([URI.file(workspaceRoot).toString()]);
    const variablesProvider: VariablesProvider = {
      getProjectVariables() {
        return new Promise((resolve, reject) => {
          resolve({
            CI_PROJECT_NAMESPACE: "gnome",
          });
        });
      },
    };
    const gitlabService = new GitlabService(includeResolver, variablesProvider);

    const result = await gitlabService.validateDocument(
      "file:" + testFilename,
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
    const variablesProvider: VariablesProvider = {
      getProjectVariables() {
        return new Promise((resolve, reject) => {
          resolve({});
        });
      },
    };
    const gitlabService = new GitlabService(includeResolver, variablesProvider);

    const result = await gitlabService.validateDocument(
      "file:.gitlab-lsp/cache/projects/GNOME/citemplates/master/templates/release-service.yml",
      text,
      reporter,
    );
    reporter.displayErrors(text);
    expect(result).not.null;
  });
});
