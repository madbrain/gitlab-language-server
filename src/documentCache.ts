import { TextDocument } from "vscode-languageserver-textdocument";
import { validateDocument } from "./lang/gitlabci";
import { ErrorReporter } from "./lang/error-reporter";
import { GitlabFile } from "./lang/gitlab.model";

export interface GitlabCachedDocument {
  version: number;
  model: GitlabFile | null;
}

const cache = new Map<string, GitlabCachedDocument>();

function ensureCache(document: TextDocument, reporter: ErrorReporter): void {
  const key = document.uri;
  if (!cache.has(key)) {
    cache.set(key, {
      version: -1,
      model: new GitlabFile(),
    });
  }
  const cacheEntry = cache.get(key)!!;
  if (cacheEntry.version !== document.version) {
    let text = document.getText();
    cacheEntry.model = validateDocument(text, reporter);
    cacheEntry.version = document.version;
  }
}

export function getGitlabDocument(
  document: TextDocument,
  reporter: ErrorReporter,
): GitlabFile | null {
  ensureCache(document, reporter);
  return cache.get(document.uri)!!.model;
}
