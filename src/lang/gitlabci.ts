import { Composer, ParsedNode, ParseOptions, Parser } from "yaml";
import { URI, Utils } from "vscode-uri";
import * as path from "path";
import * as fs from "fs";
import * as parseGitConfig from "parse-git-config";
import { ErrorReporter } from "./error-reporter";
import { ComponentSpec, GitlabFile } from "./gitlab.model";
import { GitlabFileBuilder, makeRange } from "./gitlab-builder";
import {
  GitlabFileContext,
  GitlabFileValidator,
  IncludeResolver,
} from "./gitlab-validator";
import { GitlabRemoteCache } from "./gitlab-remote-cache";

export interface MyConsole {
  log(msg: string): unknown;
}

export interface LocalFile {
  path: string;
  content: string;
}

export class DefaultIncludeResolver implements IncludeResolver {
  private gitlabRemoteCache: GitlabRemoteCache | null = null;
  private workspacesUri: string[] = [];

  constructor(private console: MyConsole) {}

  setWorkspaces(workspacesUri: string[]) {
    this.workspacesUri = workspacesUri;
    const gitlabRemoteURLs = this.workspacesUri.flatMap((uri) => {
      const workspacePath = URI.parse(uri).fsPath;
      const gitConfigPath = path.join(workspacePath, ".git/config");
      if (fs.existsSync(gitConfigPath)) {
        const gitconfig = parseGitConfig.sync({ path: gitConfigPath });
        return Object.keys(gitconfig)
          .filter((k) => k.startsWith("remote "))
          .flatMap((k) => {
            try {
              return [
                {
                  workspacePath,
                  gitlabRemoteUrl: URI.parse(gitconfig[k].url)
                    .with({ path: "" })
                    .toString(),
                },
              ];
            } catch (e) {
              // probably an git ssh URL, should we support it as well ?
              return [];
            }
          });
      } else {
        return [];
      }
    });
    if (gitlabRemoteURLs.length === 1) {
      const workspaceInfo = gitlabRemoteURLs[0];
      this.console.log(
        `Detected remote ${workspaceInfo.gitlabRemoteUrl} in ${workspaceInfo.workspacePath}`,
      );
      const cacheDir = path.join(
        workspaceInfo.workspacePath,
        ".gitlab-lsp/cache",
      );
      this.gitlabRemoteCache = new GitlabRemoteCache(
        cacheDir,
        workspaceInfo.gitlabRemoteUrl,
        this.console,
      );
    }
  }

  async findComponentFile(componentPath: string): Promise<LocalFile | null> {
    if (!this.gitlabRemoteCache) {
      return null;
    }
    const domainPos = componentPath.indexOf("/");
    const domainName = componentPath.slice(0, domainPos); // TODO use specified domainName
    const componentNamePos = componentPath.lastIndexOf("/");
    const projectPath = componentPath.slice(domainPos + 1, componentNamePos);
    const [componentName, specificVersion] = componentPath
      .slice(componentNamePos + 1)
      .split("@");
    try {
      return await this.gitlabRemoteCache.getProjectFile(
        projectPath,
        `templates/${componentName}.yml`,
        specificVersion,
      );
    } catch {
      return null;
    }
  }

  async findProjectFile(
    projectPath: string,
    filePath: string,
    ref: string | null,
  ): Promise<LocalFile | null> {
    if (!this.gitlabRemoteCache) {
      return null;
    }
    try {
      return await this.gitlabRemoteCache.getProjectFile(
        projectPath,
        filePath,
        ref ?? "HEAD",
      );
    } catch {
      return null;
    }
  }

  // TODO local file
}

export class GitlabService {
  constructor(private includeResolver: IncludeResolver) {}

  private parseDocuments(text: string, reporter: ErrorReporter) {
    const options: ParseOptions = { keepSourceTokens: true };
    const parser = new Parser();
    const composer = new Composer(options);
    const tokens = parser.parse(text);
    return Array.from(composer.compose(tokens, true, text.length));
  }

  async validateDocument(
    uri: string,
    text: string,
    reporter: ErrorReporter,
  ): Promise<GitlabFileContext | null> {
    // TODO make a validation stack on uri to detect circular dependencies

    const docs = this.parseDocuments(text, reporter);

    let spec: ComponentSpec | null = null;
    let bodyDoc = docs[0];

    if (docs.length == 2) {
      if (docs[0].contents) {
        spec = new GitlabFileBuilder(reporter).parseComponentSpecDocument(
          docs[0].contents,
        );
      }
      bodyDoc = docs[1];
    } else if (docs.length > 1) {
      reporter.reportError(
        makeRange(docs[1].contents!!),
        "expecting a single document",
      );
      return null;
    }

    if (bodyDoc.contents) {
      const parsedFile = new GitlabFileBuilder(reporter).parseGitlabFile(
        uri,
        bodyDoc.contents,
      );
      if (parsedFile) {
        return await new GitlabFileValidator(
          reporter,
          this.includeResolver,
          this,
        ).validate(parsedFile, spec);
      }
    }
    return null;
  }
}
