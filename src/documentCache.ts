import { TextDocument } from "vscode-languageserver-textdocument";
import { GitlabService } from "./lang/gitlabci";
import { ErrorReporter } from "./lang/error-reporter";
import { GitlabFile } from "./lang/gitlab.model";
import { ParsedNode } from "yaml";
import { GitlabFileContext } from "./lang/gitlab-validator";

export interface GitlabCachedDocument {
  version: number;
  content: ParsedNode | null;
  model: GitlabFileContext | null;
}

export class GitlabDocumentCache {
  private cache = new Map<string, GitlabCachedDocument>();

  constructor(private gitlabService: GitlabService) {}

  private async ensureCache(document: TextDocument, reporter: ErrorReporter) {
    const key = document.uri;
    if (!this.cache.has(key)) {
      this.cache.set(key, {
        version: -1,
        content: null,
        model: new GitlabFileContext(key, null, new GitlabFile()),
      });
    }
    const cacheEntry = this.cache.get(key)!!;
    if (cacheEntry.version !== document.version) {
      let text = document.getText();
      cacheEntry.model = await this.gitlabService.validateDocument(
        key,
        text,
        reporter,
      );
      cacheEntry.content = cacheEntry.model?.root ?? null; // TODO remove
      cacheEntry.version = document.version;
    }
  }

  async get(
    document: TextDocument,
    reporter: ErrorReporter,
  ): Promise<GitlabCachedDocument | null> {
    await this.ensureCache(document, reporter);
    return this.cache.get(document.uri)!!;
  }
}
