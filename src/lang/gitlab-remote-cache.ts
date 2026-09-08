import { URI } from "vscode-uri";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { LocalFile, MyConsole } from "./gitlabci";
import { SettingsProvider } from "./gitlab-validator";
import fetch from "node-fetch";
import https from "https";

const MIN_CACHE_CHECK_MIN = 5;

export class GitlabRemoteCache {
  private gitlabAPIURL!: URI;
  private projectIdCache = new Map<string, string>();

  constructor(
    private cacheDir: string,
    gitlabRemoteURL: string,
    private settingsProvider: SettingsProvider,
    private console: MyConsole,
  ) {
    this.gitlabAPIURL = URI.parse(gitlabRemoteURL).with({ path: "api/v4" });
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  private async getHttpConfig() {
     const headers: HeadersInit = {};
    const token = await this.settingsProvider.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return { headers, agent: new https.Agent({ rejectUnauthorized: false }) };
  }

  private async getProjectId(projectPath: string) {
    const projectId = this.projectIdCache.get(projectPath);
    if (projectId) {
      return projectId;
    }
    const url = `${this.gitlabAPIURL}/projects/${encodeURIComponent(projectPath)}`;
    const config = await this.getHttpConfig();
    this.console.log(`FETCH PROJECT INFO ${url}`);
    return fetch(url, config)
      .then((r) => r.json())
      .then((r) => {
        const projectId = (r as any).id;
        this.projectIdCache.set(projectPath, projectId);
        return projectId;
      })
      .catch(e => {
        this.console.log(`ERROR ${e}`)
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
    const normalizedPath = filePath.replace(/^\/+/, '');
    const url = `${this.gitlabAPIURL}/projects/${projectId}/repository/files/${encodeURIComponent(normalizedPath)}?ref=${ref}`;

    const fetchAndStore = () => {
      this.console.log(`FETCH ${url}`);
      return this.getHttpConfig()
        .then(config => {
          return fetch(url, config)
            .then((r) => r.json())
            .then((r) => {
              const buffer = Buffer.from((r as any).content, (r as any).encoding);
              fs.mkdirSync(path.dirname(localPath), { recursive: true });
              fs.writeFileSync(localPath, buffer);
              return { path: localPath, content: buffer.toString("utf-8") };
            });
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
      this.console.log(`FETCH CHECK ${url}`);
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
