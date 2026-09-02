import {
  CompletionItem,
  Location,
  LocationLink,
  Range,
} from "vscode-languageserver";
import { CompletionPosition, PathElement } from "./completion-positioner";
import {
  ListNode,
  MapItem,
  ScalarNode,
  Range as InternalRange,
  ListTemplateNode,
} from "./generic-model";
import { ParsedNode, YAMLMap } from "yaml";
import { GitlabFileContext } from "./gitlab-validator";
import { TextTemplate } from "./template-parser";
import { Expression } from "./expression-parser";

export interface OperationOption {
  definitionLinkSupport?: boolean;
}

export interface CompletionContext {
  document: { uri: string; makeRange: (range: InternalRange) => Range };
  position: CompletionPosition;
  context: GitlabFileContext;
  options?: OperationOption;
}

export interface GotoDefinitionContext {
  document: { uri: string; makeRange: (range: InternalRange) => Range };
  position: number;
  context: GitlabFileContext;
  options?: OperationOption;
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
          return this.processInclude(
            context,
            (include, context) => include.completeAt(context),
            [],
          );
      }
    }
    return [];
  }

  private processInclude<T>(
    context: CompletionContext,
    cb: (i: Include, c: CompletionContext) => T,
    def: T,
  ): T {
    let newPosition = {
      ...context.position,
      path: context.position.path.slice(1),
    };
    let include: Include | null = null;
    if (newPosition.path.length > 0 && newPosition.path[0].type == "item") {
      const index = newPosition.path[0].index;
      include = this.include?.value[index] ?? null;
      newPosition = {
        ...newPosition,
        path: newPosition.path.slice(1),
      };
    } else {
      // TODO if field path, check if unique and get first
    }
    if (include) {
      return cb(include, {
        ...context,
        position: newPosition,
      });
    }
    return def;
  }

  gotoDefinitionAt(
    context: GotoDefinitionContext,
  ): Location[] | LocationLink[] {
    const job = this.jobs.find((job) => job.range.contains(context.position));
    if (job) {
      return job.value.gotoDefinitionAt(context);
    }
    if (this.variables?.range.contains(context.position)) {
      // TODO temporary should use variable definitions stack
      const envs: { [name: string]: ScalarNode } = {};
      this.variables.value.forEach(
        (variable) => (envs[variable.name.value] = variable.name),
      );
      for (let variableDefinition of this.variables.value) {
        if (variableDefinition.value.range.contains(context.position)) {
          for (let element of variableDefinition.value.elements) {
            if (
              element.type === "variable" &&
              element.range.contains(context.position)
            ) {
              const name = envs[element.name];
              if (name) {
                return makeLocation(
                  context,
                  context.document.uri,
                  element.range,
                  name.range,
                );
              }
            }
          }
        }
      }
    }
    if (this.include?.range.contains(context.position)) {
      for (let include of this.include.value) {
        if (include.range.contains(context.position)) {
          return include.gotoDefinitionAt(context);
        }
      }
    }
    return [];
  }
}

export class VariableDefinition {
  constructor(
    public name: ScalarNode,
    public value: TextTemplate,
  ) {}
}

export class Include {
  component: MapItem<TextTemplate> | null = null;
  local: MapItem<TextTemplate> | null = null;
  project: MapItem<TextTemplate> | null = null;
  remote: MapItem<TextTemplate> | null = null;
  template: MapItem<TextTemplate> | null = null;

  // project
  file: MapItem<ListTemplateNode> | null = null;
  ref: MapItem<TextTemplate> | null = null;

  inputs: MapItem<InputArgument[]> | null = null;
  rules: MapItem<Rule[]> | null = null;

  // set after validation
  context: GitlabFileContext | null = null;

  constructor(public range: InternalRange) {}

  completeAt(context: CompletionContext): CompletionItem[] {
    if (
      context.position.path.length > 0 &&
      context.position.path[0].type === "field" &&
      context.position.path[0].name === "inputs"
    ) {
      if (this.component && this.context) {
        const alreadySetInputs = new Set(
          (this.inputs?.value ?? []).map((i) => i.name.value),
        );
        const allRemainingInputs = (this.context.spec?.inputs ?? [])
          .map((i) => i.keyNode.value)
          .filter((i) => !alreadySetInputs.has(i));
        return allRemainingInputs.map((i) => ({ label: i }));
      }
    }
    return [];
  }

  gotoDefinitionAt(
    operationContext: GotoDefinitionContext,
  ): Location[] | LocationLink[] {
    if (
      this.component &&
      this.context &&
      this.component.range.contains(operationContext.position)
    ) {
      const sourceRange = this.component.value.range;
      return makeLocation(
        operationContext,
        this.context.uri,
        sourceRange,
        this.context.spec?.range ?? InternalRange.NULL,
      );
    }
    if (
      this.project &&
      this.context &&
      this.file?.range.contains(operationContext.position)
    ) {
      // TODO should test remaining path to go to other files than first
      const sourceRange = this.file!.value.elements[0].range;
      return makeLocation(
        operationContext,
        this.context.uri,
        sourceRange,
        this.context.spec?.range ?? InternalRange.NULL,
      );
    }
    if (
      this.local &&
      this.local.value.range.contains(operationContext.position) &&
      this.context
    ) {
      const sourceRange = this.local.value.range;
      return makeLocation(
        operationContext,
        this.context.uri,
        sourceRange,
        this.context.spec?.range ?? InternalRange.NULL,
      );
    }
    // TODO inputs
    // TODO find the correct input field following path and search into this.context.spec
    return [];
  }
}

function makeLocation(
  operationContext: GotoDefinitionContext,
  uri: string,
  sourceRange: InternalRange,
  targetRange: InternalRange,
): Location[] | LocationLink[] {
  const range = operationContext.document.makeRange(targetRange);
  if (operationContext.options?.definitionLinkSupport) {
    return [
      {
        originSelectionRange: operationContext.document.makeRange(sourceRange),
        targetUri: uri,
        targetRange: range,
        targetSelectionRange: range,
      } as LocationLink,
    ];
  }
  return [
    {
      range: range,
      uri: uri,
    } as Location,
  ];
}

export class InputArgument {
  constructor(
    public name: ScalarNode,
    public value: ScalarNode,
  ) {}
}

export class Rule {
  // one of
  if: MapItem<Expression> | null = null;
  changes: MapItem<ScalarNode> | null = null; // could be complex array or map
  exists: MapItem<ScalarNode> | null = null; // could be complex array or map

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

  gotoDefinitionAt(operationContext: GotoDefinitionContext) {
    if (this.stage?.range.contains(operationContext.position)) {
      const sourceRange = this.stage!.value.range;
      const stageDefinition = operationContext.context.stageByName.get(
        this.stage!.value.value,
      );
      if (stageDefinition && stageDefinition.source) {
        // TODO same document is assumed
        return makeLocation(
          operationContext,
          operationContext.document.uri,
          sourceRange,
          stageDefinition.source.range,
        );
      }
    }
    if (this.extends?.value.range.contains(operationContext.position)) {
      for (let extend of this.extends.value.elements) {
        if (extend.range.contains(operationContext.position)) {
          const targetJob = operationContext.context.findJob(extend.value);
          if (targetJob) {
            return makeLocation(
              operationContext,
              operationContext.document.uri, // TODO job could be in an other document
              extend.range,
              targetJob.name.range,
            );
          }
        }
      }
    }
    if (this.dependencies?.value.range.contains(operationContext.position)) {
      for (let dependency of this.dependencies.value.elements) {
        if (dependency.range.contains(operationContext.position)) {
          const targetJob = operationContext.context.findJob(dependency.value);
          if (targetJob) {
            return makeLocation(
              operationContext,
              operationContext.document.uri, // TODO job could be in an other document
              dependency.range,
              targetJob.name.range,
            );
          }
        }
      }
    }
    if (this.needs?.range.contains(operationContext.position)) {
      for (let need of this.needs.value) {
        if (need.job.range.contains(operationContext.position)) {
          const targetJob = operationContext.context.findJob(
            need.job.value.value,
          );
          if (targetJob) {
            return makeLocation(
              operationContext,
              operationContext.document.uri, // TODO job could be in an other document
              need.job.range,
              targetJob.name.range,
            );
          }
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
  range: InternalRange | null = null;
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
