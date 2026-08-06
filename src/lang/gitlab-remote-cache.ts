import { URI, Utils } from "vscode-uri";
import { MyConsole } from "./gitlabci";

export class GitlabRemoteCache {
  constructor(
    private cacheDir: string,
    private console: MyConsole,
  ) {}

  getProjectFile(gitlabRemoteURL: URI, projectPath: string, filePath: string) {
    const url = Utils.joinPath(
      gitlabRemoteURL.with({ path: projectPath }),
      "-/raw/master",
      filePath,
    );

    this.console.log(`URL ${url.toString()}`);

    // TODO download through local cache (`.gitlab-lsp/cache/projects/{project}/{file}`)

    return fetch(url.toString()).then((r) => r.text());
  }
}
