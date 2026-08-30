import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  Pair,
  ParsedNode,
  Scalar,
  YAMLMap,
  YAMLSeq,
} from "yaml";
import { ErrorReporter } from "./error-reporter";
import {
  ComponentSpec,
  GitlabFile,
  Include,
  InputArgument,
  Job,
  JobNeed,
  JobRetry,
  Rule,
  SpecInput,
  VariableDefinition,
  Workflow,
} from "./gitlab.model";
import { MapItem, Range, ScalarNode } from "./generic-model";
import { Builder, findMapItemSeparator } from "./generic-builder";
import { TemplateParser } from "./template-parser";
import { ExpressionParser } from "./expression-parser";

export interface ParsedGitlabFile {
  uri: string;
  root: ParsedNode;
  file: GitlabFile;
}

export class GitlabFileBuilder {
  private anchors = new Map<string, ParsedNode>();

  constructor(private reporter: ErrorReporter) {}

  private collectAnchors(node: ParsedNode) {
    if (node.anchor) {
      this.anchors.set(node.anchor, node);
    }
    if (isMap(node)) {
      node.items.forEach((item) => {
        if (item.value) {
          this.collectAnchors(item.value);
        }
      });
    } else if (isSeq(node)) {
      node.items.forEach((item) => {
        this.collectAnchors(item);
      });
    }
  }

  parseGitlabFile(uri: string, node: ParsedNode): ParsedGitlabFile | null {
    // TODO use node.resolved(doc) instead of collecting anchors
    this.collectAnchors(node);

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
      const separator = findMapItemSeparator(item.srcToken!.sep)!;

      const DEPRECATED_MOVE_TO_DEFAULT = [
        "image",
        "services",
        "before_script",
        "after_script",
        "cache",
      ];
      const DEPRECATED = ["pages"];

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
        gitlabFile.include = this.parseIncludes(item, nameNode, separator);
      } else if (fieldName === "variables") {
        gitlabFile.variables = new Builder(this.reporter)
          .fromItem(item)
          .map()
          .ofItemTemplate((name, value) => new VariableDefinition(name, value));
      } else if (fieldName === "workflow") {
        gitlabFile.workflow = this.parseWorkflow(item);
      } else if (DEPRECATED_MOVE_TO_DEFAULT.includes(fieldName)) {
        this.reporter.reportError(
          makeRange(item.key),
          "deprecated at toplevel, move to default",
        );
      } else if (DEPRECATED.includes(fieldName)) {
        this.reporter.reportError(makeRange(item.key), "deprecated");
      } else {
        if (!item.value) {
          this.reporter.reportError(makeRange(item.key), "expecting a value");
        } else {
          const job = this.parseJob(nameNode, item.value);
          if (job) {
            gitlabFile.addJob(
              new MapItem(makeItemRange(item), nameNode, separator, job),
            );
          }
        }
      }
    });
    return { uri, root: node, file: gitlabFile };
  }

  parseWorkflow(
    item: Pair<ParsedNode, ParsedNode | null>,
  ): MapItem<Workflow> | null {
    if (!item.value) {
      this.reporter.reportError(makeRange(item.key), "expecting a value");
      return null;
    }
    if (!isMap(item.value)) {
      this.reporter.reportError(makeRange(item.value), "expecting a map");
      return null;
    }
    const workflow = new Workflow();
    item.value.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(
          makeRange(item.key),
          "expecting a scalar key",
        );
        return;
      }
      const fieldName = item.key.value as string;
      const keyNode = new ScalarNode(makeRange(item.key), fieldName);
      const separator = findMapItemSeparator(item.srcToken!.sep)!;
      if (fieldName === "name") {
        workflow.name = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .single();
      } else if (fieldName === "rules") {
        workflow.rules = this.parseRules(item, keyNode, separator, item.value);
      } else {
        this.reporter.reportWarning(
          makeRange(item.key),
          `TODO workflow::${fieldName}`,
        );
      }
    });
    return new MapItem(
      makeItemRange(item),
      new ScalarNode(makeRange(item.key), (item.key as Scalar).value as string),
      findMapItemSeparator(item.srcToken?.sep)!,
      workflow,
    );
  }

  private parseIncludes(
    item: Pair<ParsedNode, ParsedNode | null>,
    nameNode: ScalarNode,
    separator: number,
  ): MapItem<Include[]> | null {
    const includes = [];
    if (!item.value) {
      this.reporter.reportError(makeRange(item.key), "expecting a value");
    } else if (isScalar(item.value)) {
      const r = makeRange(item.value);
      const value = new TemplateParser(
        item.value.value as string,
        r,
        this.reporter,
      ).parse();

      // TODO could also be remote depending on the URL, but depends on the evaluation of the template
      const include = new Include(r);
      include.local = new MapItem(
        makeItemRange(item),
        nameNode,
        separator,
        value,
      );
      includes.push(include);
    } else if (isMap(item.value)) {
      const include = this.parseInclude(item.value);
      if (include) {
        includes.push(include);
      }
    } else if (isSeq(item.value)) {
      item.value.items.forEach((item) => {
        const include = this.parseInclude(item);
        if (include) {
          includes.push(include);
        }
      });
    } else {
      this.reporter.reportError(makeRange(item.key), "expecting a map or list");
    }
    return new MapItem(makeItemRange(item), nameNode, separator, includes);
  }

  private parseInclude(node: ParsedNode) {
    if (!isMap(node)) {
      this.reporter.reportError(makeRange(node), "expecting a map");
      return null;
    }
    const include = new Include(makeRange(node));
    node.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(makeRange(item.key), "expecting scalar key");
        return;
      }
      const fieldName = item.key.value as string;
      const keyNode = new ScalarNode(makeRange(item.key), fieldName);
      const separator = findMapItemSeparator(item.srcToken!.sep)!;
      if (fieldName === "component") {
        include.component = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .singleTemplate();
      } else if (fieldName === "local") {
        // TODO also default value when include is single
        include.local = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .singleTemplate();
      } else if (fieldName === "project") {
        include.project = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .singleTemplate();
      } else if (fieldName === "file") {
        include.file = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .singleToList()
          .ofStringTemplate();
      } else if (fieldName === "ref") {
        include.ref = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .singleTemplate();
      } else if (fieldName === "remote") {
        include.remote = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .singleTemplate();
      } else if (fieldName === "template") {
        include.template = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .singleTemplate();
      } else if (fieldName === "inputs") {
        include.inputs = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .map()
          .ofItemString((name, value) => new InputArgument(name, value));
      } else if (fieldName === "rules") {
        include.rules = this.parseRules(item, keyNode, separator, item.value);
      } else {
        this.reporter.reportError(
          makeRange(item.key),
          `TODO include::${fieldName}`,
        );
      }
    });
    return include;
  }

  private parseRules(
    item: Pair<ParsedNode, ParsedNode | null>,
    keyNode: ScalarNode,
    separator: number,
    value: ParsedNode | null,
  ): MapItem<Rule[]> | null {
    if (!value) {
      this.reporter.reportError(keyNode.range, "expecting a value");
      return null;
    }
    if (!isSeq(value)) {
      this.reporter.reportError(makeRange(value), "expecting a list");
      return null;
    }
    const result: Rule[] = [];
    value.items.forEach((item) => {
      const rule = this.parseRule(item);
      if (rule) {
        result.push(rule);
      }
    });
    return new MapItem(makeItemRange(item), keyNode, separator, result);
  }

  private parseRule(node: ParsedNode): Rule | null {
    if (isAlias(node)) {
      const aliasedNode = this.anchors.get(node.source);
      if (!aliasedNode) {
        this.reporter.reportError(makeRange(node), `unknown anchor`);
        return null;
      }
      // TODO interpret aliasedNode as rule
      return null;
    }
    if (!isMap(node)) {
      this.reporter.reportError(makeRange(node), "expecting a map");
      return null;
    }
    const rule = new Rule();
    node.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(makeRange(item.key), "expecting scalar key");
        return;
      }
      const fieldName = item.key.value as string;
      if (fieldName === "if") {
        rule.if = new Builder(this.reporter).fromItem(item).required().singleExpression();
      } else if (fieldName === "changes") {
        this.reporter.reportWarning(makeRange(item.key), "TODO");
      } else if (fieldName === "exists") {
        this.reporter.reportWarning(makeRange(item.key), "TODO");
      } else if (fieldName === "when") {
        rule.when = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .single();
      } else if (fieldName === "variables") {
        rule.variables = new Builder(this.reporter)
          .fromItem(item)
          .map()
          .ofItemTemplate((name, value) => new VariableDefinition(name, value));
      } else {
        this.reporter.reportWarning(
          makeRange(item.key),
          `TODO Rule::${fieldName}`,
        );
      }
    });
    return rule;
  }

  private parseJob(nameNode: ScalarNode, node: ParsedNode): Job | null {
    if (!isMap(node)) {
      this.reporter.reportError(makeRange(node), "expecting a map");
      return null;
    }
    const job = new Job(nameNode, node);
    if (!job.isHidden()) {
      this.parseRealJob(job);
    }
    return job;
  }

  private parseRealJob(job: Job) {
    const node = job.node;
    node.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(makeRange(item.key), "expecting scalar key");
        return;
      }
      const fieldName = item.key.value as string;
      const keyNode = new ScalarNode(makeRange(item.key), fieldName);
      const separator = findMapItemSeparator(item.srcToken!.sep)!;
      if (fieldName === "stage") {
        job.stage = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .single();
      } else if (fieldName === "image") {
        job.image = new Builder(this.reporter).fromItem(item).single();
      } else if (fieldName === "retry") {
        job.retry = this.parseJobRetry(item, keyNode, separator);
      } else if (fieldName === "tags") {
        job.tags = new Builder(this.reporter).fromItem(item).list().ofString();
      } else if (fieldName === "script") {
        job.script = new Builder(this.reporter)
          .fromItem(item)
          .singleToList()
          .ofString();
      } else if (fieldName === "before_script") {
        job.beforeScript = new Builder(this.reporter)
          .fromItem(item)
          .singleToList()
          .ofString();
      } else if (fieldName === "after_script") {
        job.afterScript = new Builder(this.reporter)
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
        job.needs = this.parseJobNeeds(item, keyNode, separator, item.value);
      } else if (fieldName === "dependencies") {
        job.dependencies = new Builder(this.reporter)
          .fromItem(item)
          .list()
          .ofString();
      } else if (fieldName === "variables") {
        job.variables = new Builder(this.reporter)
          .fromItem(item)
          .map()
          .ofItemTemplate((name, value) => new VariableDefinition(name, value));
      } else if (fieldName === "rules") {
        job.rules = this.parseRules(item, keyNode, separator, item.value);
      } else {
        // this.reporter.reportError(
        //   makeRange(item.key),
        //   `TODO job::${fieldName}`,
        // );
      }
    });
    job.built = true;
  }

  private parseJobNeeds(
    item: Pair<ParsedNode, ParsedNode | null>,
    keyNode: ScalarNode,
    separator: number,
    node: ParsedNode | null,
  ): MapItem<JobNeed[]> | null {
    const jobNeeds: JobNeed[] = [];
    if (!isSeq(node)) {
      this.reporter.reportError(keyNode.range, "expecting a list");
    } else {
      node.items.forEach((seqItem) => {
        if (isScalar(seqItem)) {
          const jobNeed = new JobNeed();
          jobNeed.job = new MapItem(
            makeRange(seqItem),
            keyNode,
            separator,
            new ScalarNode(makeRange(seqItem), seqItem.value as string),
          );
          jobNeeds.push(jobNeed);
        } else if (isMap(seqItem)) {
          jobNeeds.push(this.parseJobNeed(seqItem));
        } else {
          this.reporter.reportError(
            makeRange(seqItem),
            "expecting a job name or map",
          );
        }
      });
    }
    return new MapItem(makeItemRange(item), keyNode, separator, jobNeeds);
  }

  private parseJobNeed(
    node: YAMLMap.Parsed<ParsedNode, ParsedNode | null>,
  ): JobNeed {
    let jobNeed = new JobNeed();
    node.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(makeRange(item.key), "expecting scalar key");
        return;
      }
      const fieldName = item.key.value as string;
      if (fieldName === "job") {
        jobNeed.job = new Builder(this.reporter)
          .fromItem(item)
          .required()
          .single()!;
      } else if (fieldName === "artifacts") {
        jobNeed.artifacts = new Builder(this.reporter).fromItem(item).single();
      }
    });
    return jobNeed;
  }

  private parseJobRetry(
    retryItem: Pair<ParsedNode, ParsedNode | null>,
    keyNode: ScalarNode,
    separator: number,
  ): MapItem<JobRetry> {
    const retry = new JobRetry();
    if (isMap(retryItem.value)) {
      retryItem.value.items.forEach((item) => {
        if (!isScalar(item.key)) {
          this.reporter.reportError(
            makeRange(item.key),
            "expecting scalar key",
          );
          return;
        }
        const fieldName = item.key.value as string;
        if (fieldName === "max") {
          retry.max = new Builder(this.reporter)
            .fromItem(item)
            .required()
            .single();
        } else if (fieldName === "when") {
          retry.when = new Builder(this.reporter)
            .fromItem(item)
            .singleToList()
            .ofString();
        } else if (fieldName === "exit_codes") {
          retry.exitCodes = new Builder(this.reporter)
            .fromItem(item)
            .singleToList()
            .ofString();
        }
      });
    } else {
      retry.max = new Builder(this.reporter).fromItem(retryItem).single();
    }
    return new MapItem(makeItemRange(retryItem), keyNode, separator, retry);
  }

  parseComponentSpecDocument(node: ParsedNode) {
    if (!isMap(node)) {
      this.reporter.reportError(makeRange(node), "expecting a map");
      return null;
    }
    const componentSpec = new ComponentSpec();
    node.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(makeRange(item.key), "expecting scalar key");
        return;
      }
      const fieldName = item.key.value as string;
      if (fieldName === "spec") {
        this.parseComponentSpec(item, componentSpec);
      } else {
        this.reporter.reportWarning(makeRange(item.key), "unexpected key");
      }
    });

    return componentSpec;
  }

  private parseComponentSpec(
    item: Pair<ParsedNode, ParsedNode | null>,
    componentSpec: ComponentSpec,
  ) {
    if (!isMap(item.value)) {
      this.reporter.reportError(
        makeRange(item.key),
        "expecting a map as value",
      );
      return;
    }
    componentSpec.range = makeRange(item.key);
    item.value.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(makeRange(item.key), "expecting scalar key");
        return;
      }
      const fieldName = item.key.value as string;
      if (fieldName === "inputs") {
        this.parseComponentInputs(item, componentSpec);
      }
    });
  }

  private parseComponentInputs(
    item: Pair<ParsedNode, ParsedNode | null>,
    componentSpec: ComponentSpec,
  ) {
    if (!isMap(item.value)) {
      this.reporter.reportError(
        makeRange(item.key),
        "expecting a map as value",
      );
      return;
    }
    item.value.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(makeRange(item.key), "expecting scalar key");
        return;
      }

      const fieldName = item.key.value as string;
      const nameNode = new ScalarNode(makeRange(item.key), fieldName);
      const separator = findMapItemSeparator(item.srcToken!.sep)!;
      const input = this.parseInput(nameNode, item.value);
      if (input) {
        componentSpec.inputs.push(
          new MapItem(makeItemRange(item), nameNode, separator, input),
        );
      }
    });
  }

  private parseInput(nameNode: ScalarNode, node: ParsedNode | null) {
    if (!isMap(node)) {
      this.reporter.reportError(nameNode.range, "expecting a map as value");
      return null;
    }
    const input = new SpecInput(nameNode);
    node.items.forEach((item) => {
      if (!isScalar(item.key)) {
        this.reporter.reportError(makeRange(item.key), "expecting scalar key");
        return;
      }
      const fieldName = item.key.value as string;
      const keyNode = new ScalarNode(makeRange(item.key), fieldName);
      const separator = findMapItemSeparator(item.srcToken!.sep)!;

      if (fieldName === "description") {
        input.description = new Builder(this.reporter).fromItem(item).single();
      } else if (fieldName === "default") {
        input.default = new Builder(this.reporter).fromItem(item).single();
      } else if (fieldName === "option") {
        input.option = new Builder(this.reporter)
          .fromItem(item)
          .list()
          .ofString();
      } else if (fieldName === "regex") {
        input.regex = new Builder(this.reporter).fromItem(item).single();
      } else if (fieldName === "type") {
        input.type = new Builder(this.reporter).fromItem(item).single();
      } else if (fieldName === "rules") {
        input.rules = this.parseRules(item, keyNode, separator, item.value);
      }
    });
    return input;
  }
}

export function makeRange(node: ParsedNode): Range {
  return new Range(node.range[0], node.range[1]);
}

export function makeItemRange(
  item: Pair<ParsedNode, ParsedNode | null>,
): Range {
  const keyRange = makeRange(item.key);
  if (item.value) {
    return makeRange(item.value).merge(keyRange);
  }
  return keyRange;
}
