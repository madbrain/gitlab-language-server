import { CompletionItem } from "vscode-languageserver";
import { completionPosition } from "./completion-positioner";
import { ListNode, MapItem, MapNode, ScalarNode } from "./generic-model";

export interface CompletionContext {
  position: completionPosition;
  file: GitlabFile;
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
  script: MapItem<ListNode> | null = null;
  needs: MapItem<ListNode> | null = null;
  dependencies: MapItem<ListNode> | null = null;
  extends: MapItem<ListNode> | null = null;
  variables: MapItem<VariableDefinition[]> | null = null;
  constructor(public name: ScalarNode) {}

  completeAt(context: CompletionContext) {
    if (context.position.path.length == 0) {
      switch (context.position.type) {
        case "complete-key":
        case "complete-in-key":
          const result = [];
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
      context.position.path.length > 0 &&
      context.position.path[0].type === "field"
    ) {
      const fieldName = context.position.path[0].name;
      switch (fieldName) {
        case "stage":
          return (
            context.file.stages?.value.elements.map((stage) => ({
              label: stage.value,
            })) ?? []
          );
        case "needs":
          return context.file.jobs
            .map((job) => job.keyNode)
            .filter((job) => job.value !== this.name.value)
            .map((job) => ({
              label: job.value,
            }));
      }
    }
    return [];
  }
}
