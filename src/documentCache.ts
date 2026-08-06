import { TextDocument } from "vscode-languageserver-textdocument";
import { GitlabService } from "./lang/gitlabci";
import { ErrorReporter } from "./lang/error-reporter";
import { GitlabFile } from "./lang/gitlab.model";
import { ParsedNode } from "yaml";

export interface GitlabCachedDocument {
  version: number;
  content: ParsedNode | null;
  model: GitlabFile | null;
}

export class GitlabDocumentCache {
  private cache = new Map<string, GitlabCachedDocument>();

  constructor(private gitlabService: GitlabService) {}

  private ensureCache(document: TextDocument, reporter: ErrorReporter): void {
    const key = document.uri;
    if (!this.cache.has(key)) {
      this.cache.set(key, {
        version: -1,
        content: null,
        model: new GitlabFile(),
      });
    }
    const cacheEntry = this.cache.get(key)!!;
    if (cacheEntry.version !== document.version) {
      let text = document.getText();
      cacheEntry.content = this.gitlabService.parseDocument(text, reporter);
      if (cacheEntry.content) {
        cacheEntry.model = this.gitlabService.validateDocument(
          cacheEntry.content,
          reporter,
        );
      }
      cacheEntry.version = document.version;
    }
  }

  get(
    document: TextDocument,
    reporter: ErrorReporter,
  ): GitlabCachedDocument | null {
    this.ensureCache(document, reporter);
    return this.cache.get(document.uri)!!;
  }
}
