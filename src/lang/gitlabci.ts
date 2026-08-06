import { Composer, ParsedNode, ParseOptions, Parser } from "yaml";
import { URI, Utils } from "vscode-uri";
import * as path from "path";
import * as fs from "fs";
import * as parseGitConfig from "parse-git-config";
import { ErrorReporter } from "./error-reporter";
import { GitlabFile } from "./gitlab.model";
import { GitlabFileBuilder, makeRange } from "./gitlab-builder";
import { GitlabFileValidator, IncludeResolver } from "./gitlab-validator";

export interface MyConsole {
  log(msg: string): unknown;
}

export class DefaultIncludeResolver implements IncludeResolver {
  private workspacesUri: string[] = [];

  constructor(private console: MyConsole) {}

  setWorkspaces(workspacesUri: string[]) {
    this.workspacesUri = workspacesUri;
  }

  findComponentFile(componentPath: string): GitlabFile | null {
    // TODO
    return null;
  }

  findProjectFile(
    projectPath: string,
    filePath: string,
    ref: string | null,
  ): GitlabFile | null {
    this.workspacesUri.forEach((uri) => {
      const gitConfigPath = path.join(URI.parse(uri).fsPath, ".git/config");
      if (fs.existsSync(gitConfigPath)) {
        const gitconfig = parseGitConfig.sync({ path: gitConfigPath });
        const gitlabRemoteURLs = Object.keys(gitconfig)
          .filter((k) => k.startsWith("remote "))
          .map((k) => URI.parse(gitconfig[k].url));

        if (gitlabRemoteURLs.length == 1) {
          // TODO should maybe use gitlab API ?
          const url = Utils.joinPath(
            gitlabRemoteURLs[0].with({ path: projectPath }),
            "-/raw/master",
            filePath,
          );

          this.console.log(`URL ${url.toString()}`);
          // TODO example https://gitlab.gnome.org/GNOME/citemplates/-/raw/master/flatpak/flatpak_ci_initiative.yml?ref_type=heads&inline=false
        }
      }
    });

    // TODO download through local cache (`.gitlab-lsp/cache/projects/{project}/{file}`)
    return null;
  }

  // TODO local file
}

export class GitlabService {
  constructor(private includeResolver: IncludeResolver) {}

  parseDocument(text: string, reporter: ErrorReporter) {
    const options: ParseOptions = { keepSourceTokens: true };
    const parser = new Parser();
    const composer = new Composer(options);
    const tokens = parser.parse(text);
    const docs = Array.from(composer.compose(tokens, true, text.length));

    if (docs.length > 1) {
      reporter.reportError(
        makeRange(docs[1].contents!!),
        "expecting a single document",
      );
      return null;
    }

    return docs[0].contents;
  }

  validateDocument(
    root: ParsedNode,
    reporter: ErrorReporter,
  ): GitlabFile | null {
    const file = new GitlabFileBuilder(reporter).parseGitlabFile(root);
    if (file) {
      const context = new GitlabFileValidator(
        reporter,
        this.includeResolver,
      ).validate(file);
      return file;
    }
    return null;
  }
}
