import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ConsoleErrorReporter } from "./console-error-reporter";
import { DefaultIncludeResolver, GitlabService } from "./gitlabci";
import { URI } from "vscode-uri";

describe("Parse and convert", () => {
  test("Should parse and validate YAML to GitlabCI", () => {
    const workspaceRoot = resolve("../workspace/atomix");
    const text = readFileSync(workspaceRoot + "/.gitlab-ci.yml", "utf8");

    const reporter = new ConsoleErrorReporter();
    const includeResolver = new DefaultIncludeResolver({ log: console.log });
    includeResolver.setWorkspaces([URI.file(workspaceRoot).toString()]);
    const gitlabService = new GitlabService(includeResolver);
    const root = gitlabService.parseDocument(text, reporter);
    if (root) {
      const result = gitlabService.validateDocument(root, reporter);
      expect(result).not.null;
    }
    reporter.displayErrors(text);
  });
});
