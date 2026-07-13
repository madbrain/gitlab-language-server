import { isMap, isScalar, Pair, ParsedNode } from "yaml";
import { ErrorReporter } from "./error-reporter";
import { GitlabFile, Include, Job } from "./gitlab.model";
import { Range, ScalarNode } from "./generic-model";
import { Builder } from "./generic-builder";

export class GitlabFileBuilder {
  constructor(private reporter: ErrorReporter) {}
  parseGitlabFile(node: ParsedNode): GitlabFile | null {
    if (!isMap(node)) {
      this.reporter.reportError(makeRange(node), "expecting a map");
      return null;
    }
    const gitlabFile = new GitlabFile();
    node.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(makeRange(item.key), "expecting scalar key");
        return;
      }
      const fieldName = item.key.value as string;
      const nameNode = new ScalarNode(makeRange(item.key), fieldName);

      const DEPRECATED_MOVE_TO_DEFAULT = [
        "image",
        "services",
        "before_script",
        "after_script",
        "cache",
      ];
      const DEPRECATED = ["!reference", "pages"];

      if (fieldName === "stages") {
        gitlabFile.stages = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .list()
          .minItems(1)
          .ofString();
      } else if (fieldName === "default") {
        this.reporter.reportWarning(makeRange(item.key), "TODO");
      } else if (fieldName === "include") {
        if (!item.value) {
          this.reporter.reportError(makeRange(item.key), "expecting a value");
        } else {
          const include = this.parseInclude(nameNode, item.value);
          if (include) {
            gitlabFile.includes.push(include);
          }
        }
      } else if (fieldName === "variables") {
        this.reporter.reportWarning(makeRange(item.key), "TODO");
      } else if (fieldName === "workflow") {
        this.reporter.reportWarning(makeRange(item.key), "TODO");
      } else if (DEPRECATED_MOVE_TO_DEFAULT.includes(fieldName)) {
        this.reporter.reportError(
          makeRange(item.key),
          "deprecated at toplevel, move to default",
        );
      } else if (DEPRECATED.includes(fieldName)) {
        this.reporter.reportError(makeRange(item.key), "deprecated");
      } else {
        if (fieldName.startsWith(".")) {
          // TODO delay analysis until we known its usage
          this.reporter.reportWarning(makeRange(item.key), "TODO template");
        } else {
          if (!item.value) {
            this.reporter.reportError(makeRange(item.key), "expecting a value");
          } else {
            const job = this.parseJob(nameNode, item.value);
            if (job) {
              gitlabFile.jobs.push(job);
            }
          }
        }
      }
    });
    return gitlabFile;
  }

  private parseInclude(nameNode: ScalarNode, node: ParsedNode) {
    if (!isMap(node)) {
      this.reporter.reportError(makeRange(node), "expecting a map");
      return null;
    }
    const include = new Include(nameNode);
    node.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(makeRange(item.key), "expecting scalar key");
        return;
      }
      const fieldName = item.key.value as string;
      if (fieldName === "local") {
        // TODO also default value when include is single
        include.local = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .single();
      } else {
        this.reporter.reportError(
          makeRange(item.key),
          `TODO job::${fieldName}`,
        );
      }
    });
    return include;
  }

  private parseJob(nameNode: ScalarNode, node: ParsedNode): Job | null {
    if (!isMap(node)) {
      this.reporter.reportError(makeRange(node), "expecting a map");
      return null;
    }
    const job = new Job(nameNode);
    node.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(makeRange(item.key), "expecting scalar key");
        return;
      }
      const fieldName = item.key.value as string;
      if (fieldName === "stage") {
        job.stage = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .single();
      } else if (fieldName === "script") {
        job.script = new Builder(this.reporter)
          .fromItem(item)
          .singleToList()
          .ofString();
      } else if (fieldName === "extends") {
        job.extends = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .singleToList()
          .ofString();
      } else if (fieldName === "needs") {
        job.needs = new Builder(this.reporter).fromItem(item).list().ofString();
      } else {
        this.reporter.reportError(
          makeRange(item.key),
          `TODO job::${fieldName}`,
        );
      }
    });
    return job;
  }
}

export function makeRange(node: ParsedNode): Range {
  return new Range(node.range[0], node.range[1]);
}
