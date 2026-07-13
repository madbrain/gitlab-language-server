import { Composer, Parser } from "yaml";
import { ErrorReporter } from "./error-reporter";
import { GitlabFile } from "./gitlab.model";
import { GitlabFileBuilder, makeRange } from "./gitlab-builder";
import { GitlabFileValidator } from "./gitlab-validator";

export function validateDocument(
  text: string,
  reporter: ErrorReporter,
): GitlabFile | null {
  const options = {};
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

  const root = docs[0].contents;

  if (root) {
    const file = new GitlabFileBuilder(reporter).parseGitlabFile(root);
    if (file) {
      new GitlabFileValidator(reporter).validate(file);
      return file;
    }
  }
  return null;
}
