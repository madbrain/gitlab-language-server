import { CompletionItem, Location, Range } from "vscode-languageserver";
import { CompletionPosition } from "./completion-positioner";
import {
  ListNode,
  MapItem,
  ScalarNode,
  Range as InternalRange,
} from "./generic-model";
import { ParsedNode, YAMLMap } from "yaml";
import { GitlabFileContext } from "./gitlab-validator";

export interface CompletionContext {
  document: { uri: string; makeRange: (range: InternalRange) => Range };
  position: CompletionPosition;
  context: GitlabFileContext;
}

export class GitlabFile {
  include: MapItem<Include[]> | null = null;
  variables: MapItem<VariableDefinition[]> | null = null;
  stages: MapItem<ListNode> | null = null;
  workflow: MapItem<Workflow> | null = null;
  jobs: MapItem<Job>[] = [];

  addJob(job: MapItem<Job>) {
    this.jobs.push(job);
  }

  completeAt(context: CompletionContext): CompletionItem[] {
    if (context.position.path.length == 0) {
      switch (context.position.type) {
        case "complete-key":
        case "complete-in-key":
          const result = [{ label: "default" }];
          if (!this.stages) {
            result.push({ label: "stages" });
          }
          if (!this.include) {
            result.push({ label: "include" });
          }
          if (!this.variables) {
            result.push({ label: "variables" });
          }
          if (!this.workflow) {
            result.push({ label: "workflow" });
          }
          return result;
      }
    } else if (
      context.position.path.length > 0 &&
      context.position.path[0].type == "field"
    ) {
      const fieldName = context.position.path[0].name;
      const job = this.jobs.find((job) => job.keyNode.value === fieldName);
      if (job) {
        return job.value.completeAt({
          ...context,
          position: {
            ...context.position,
            path: context.position.path.slice(1),
          },
        });
      }
      switch (fieldName) {
        case "include":
          return [];
      }
      return [];
    }
    return [];
  }

  gotoDefinitionAt(context: CompletionContext) {
    if (
      context.position.path.length > 0 &&
      context.position.path[0].type == "field"
    ) {
      const fieldName = context.position.path[0].name;
      const job = this.jobs.find((job) => job.keyNode.value === fieldName);
      if (job) {
        return job.value.gotoDefinitionAt({
          ...context,
          position: {
            ...context.position,
            path: context.position.path.slice(1),
          },
        });
      }
      switch (fieldName) {
        case "include":
          // TODO get include index and delegate
          return [];
      }
      return [];
    }
    return [];
  }
}

export class VariableDefinition {
  constructor(
    public name: ScalarNode,
    public value: ScalarNode,
  ) {}
}

export class Include {
  component: MapItem<ScalarNode> | null = null;
  local: MapItem<ScalarNode> | null = null;
  project: MapItem<ScalarNode> | null = null;
  remote: MapItem<ScalarNode> | null = null;
  template: MapItem<ScalarNode> | null = null;

  // project
  file: MapItem<ListNode> | null = null;
  ref: MapItem<ScalarNode> | null = null;

  inputs: MapItem<InputArgument[]> | null = null;
  rules: MapItem<Rule[]> | null = null;
  constructor() {}
}

export class InputArgument {
  constructor(
    public name: ScalarNode,
    public value: ScalarNode,
  ) {}
}

export class Rule {
  if: MapItem<ScalarNode> | null = null;
  changes: MapItem<ScalarNode> | null = null;
  exists: MapItem<ScalarNode> | null = null;
  when: MapItem<ScalarNode> | null = null;
  variables: MapItem<VariableDefinition[]> | null = null;
}

export class Workflow {
  name: MapItem<ScalarNode> | null = null;
  rules: MapItem<Rule[]> | null = null;
}

export class Job {
  stage: MapItem<ScalarNode> | null = null;
  image: MapItem<ScalarNode> | null = null;
  tags: MapItem<ListNode> | null = null;
  script: MapItem<ListNode> | null = null;
  beforeScript: MapItem<ListNode> | null = null;
  afterScript: MapItem<ListNode> | null = null;
  needs: MapItem<JobNeed[]> | null = null;
  dependencies: MapItem<ListNode> | null = null;
  extends: MapItem<ListNode> | null = null;
  variables: MapItem<VariableDefinition[]> | null = null;
  rules: MapItem<Rule[]> | null = null;
  retry: MapItem<JobRetry> | null = null;

  built = false;
  extenders: Job[] = [];

  constructor(
    public name: ScalarNode,
    public node: YAMLMap<ParsedNode, ParsedNode | null>,
  ) {}

  isHidden() {
    return this.name.value.startsWith(".");
  }

  completeAt(operationContext: CompletionContext) {
    if (operationContext.position.path.length == 0) {
      switch (operationContext.position.type) {
        case "complete-key":
        case "complete-in-key":
        case "complete-value":
          const result: CompletionItem[] = [];
          // TODO may insert ": " as well if empty after cursor
          if (!this.stage) {
            result.push({ label: "stage" });
          }
          if (!this.script) {
            result.push({ label: "script" });
          }
          if (!this.needs) {
            result.push({ label: "needs" });
          }
          if (!this.extends) {
            result.push({ label: "extends" });
          }
          if (!this.dependencies) {
            result.push({ label: "dependencies" });
          }
          return result;
      }
    } else if (
      operationContext.position.path.length > 0 &&
      operationContext.position.path[0].type === "field"
    ) {
      const fieldName = operationContext.position.path[0].name;
      switch (fieldName) {
        case "stage":
          return operationContext.context.stages.map((stage, i) => ({
            label: stage,
            sortText: i.toString().padStart(3, "0"), // preserve stage order
          }));
        case "needs":
          // TODO should get values from global context and not just local file
          // TODO should check the format of the specific selected need (could be an object with multiple fields)
          return operationContext.context.mainFile.jobs
            .map((job) => job.keyNode)
            .filter((job) => job.value !== this.name.value)
            .map((job) => ({
              label: job.value,
            }));
      }
    }
    return [];
  }

  gotoDefinitionAt(operationContext: CompletionContext): Location[] {
    if (
      operationContext.position.path.length > 0 &&
      operationContext.position.path[0].type === "field" &&
      (operationContext.position.type === "complete-in-scalar" ||
        operationContext.position.type === "complete-value")
    ) {
      const fieldName = operationContext.position.path[0].name;
      switch (fieldName) {
        case "stage": {
          const stageDefinition = operationContext.context.stageByName.get(
            this.stage!.value.value,
          );
          if (stageDefinition && stageDefinition.source) {
            const range = operationContext.document.makeRange(
              stageDefinition.source.range,
            );
            // TODO same document is assumed
            // TODO should use LocationLink if available to use originSelectionRange
            return [{ range, uri: operationContext.document.uri }];
          }
          return [];
        }
      }
    }
    return [];
  }
}

export class JobNeed {
  job!: MapItem<ScalarNode>;
  /** type: boolean default: true */
  artifacts: MapItem<ScalarNode> | null = null;
}

export class JobRetry {
  /**
   * values: { 0, 1, 2 }
   * default: 0
   */
  max: MapItem<ScalarNode> | null = null;
  when: MapItem<ListNode> | null = null;
  /**
   * type: integer
   */
  exitCodes: MapItem<ListNode> | null = null;
}

export class ComponentSpec {
  inputs: MapItem<SpecInput>[] = [];

  findInput(name: string) {
    return this.inputs.find((i) => i.keyNode.value === name);
  }
}

export class SpecInput {
  description: MapItem<ScalarNode> | null = null;
  default: MapItem<ScalarNode> | null = null;
  option: MapItem<ListNode> | null = null;
  regex: MapItem<ScalarNode> | null = null;
  type: MapItem<ScalarNode> | null = null;
  rules: MapItem<Rule[]> | null = null;
  constructor(public name: ScalarNode) {}
}
