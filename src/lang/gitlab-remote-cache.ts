import { URI } from "vscode-uri";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { LocalFile, MyConsole } from "./gitlabci";

const MIN_CACHE_CHECK_MIN = 5;

export class GitlabRemoteCache {
  private gitlabAPIURL!: URI;
  private projectIdCache = new Map<string, string>();

  constructor(
    private cacheDir: string,
    gitlabRemoteURL: string,
    private console: MyConsole,
  ) {
    this.gitlabAPIURL = URI.parse(gitlabRemoteURL).with({ path: "api/v4" });
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  private async getProjectId(projectPath: string) {
    const projectId = this.projectIdCache.get(projectPath);
    if (projectId) {
      return projectId;
    }
    const url = `${this.gitlabAPIURL}/projects/${encodeURIComponent(projectPath)}`;
    return await fetch(url.toString())
      .then((r) => r.json())
      .then((r) => {
        const projectId = r.id;
        this.projectIdCache.set(projectPath, projectId);
        return projectId;
      });
  }

  async getProjectFile(
    projectPath: string,
    filePath: string,
    ref: string = "HEAD",
  ): Promise<LocalFile | null> {
    const projectId = await this.getProjectId(projectPath);
    const localPath = path.join(
      this.cacheDir,
      "projects",
      projectPath,
      ref,
      filePath,
    );
    const url = `${this.gitlabAPIURL}/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}?ref=${ref}`;

    const fetchAndStore = () => {
      this.console.log(`FETCH ${url}`);
      return fetch(url)
        .then((r) => r.json())
        .then((r) => {
          const buffer = Buffer.from(r.content, r.encoding);
          fs.mkdirSync(path.dirname(localPath), { recursive: true });
          fs.writeFileSync(localPath, buffer);
          return { path: localPath, content: buffer.toString("utf-8") };
        });
    };

    if (fs.existsSync(localPath)) {
      const changeMinutes =
        (new Date().valueOf() - fs.statSync(localPath).mtime.valueOf()) /
        (1000 * 60);
      const fileContent = fs.readFileSync(localPath, { encoding: "utf-8" });
      if (changeMinutes < MIN_CACHE_CHECK_MIN) {
        return { path: localPath, content: fileContent };
      }
      const fileHash = createHash("sha256").update(fileContent).digest("hex");
      return fetch(url, { method: "HEAD" }).then((r) => {
        const remoteHash = r.headers.get("x-gitlab-content-sha256");
        if (fileHash === remoteHash) {
          return { path: localPath, content: fileContent };
        }
        return fetchAndStore();
      });
    }
    return fetchAndStore();
  }
}
