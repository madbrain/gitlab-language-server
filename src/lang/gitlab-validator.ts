import { ErrorReporter } from "./error-reporter";
import { GitlabFile, Job, Rule, VariableDefinition } from "./gitlab.model";
import { MapItem, ScalarNode } from "./generic-model";

class GitlabFileContext {
  stages = DEFAULT_STAGES;
  stageByName: Map<string, StageDefinition> = new Map(
    DEFAULT_STAGES.map((n) => [n, new StageDefinition(n)]),
  );
  jobs = new Map<string, Job>();

  constructor(public mainFile: GitlabFile) {}

  addStage(stage: ScalarNode) {
    this.stages.push(stage.value);
    this.stageByName.set(stage.value, new StageDefinition(stage.value, stage));
  }

  isStageBefore(firstStage: string, secondStage: string): boolean {
    return this.stages.indexOf(firstStage) < this.stages.indexOf(secondStage);
  }
}

const DEFAULT_STAGES = [".pre", "build", "test", "deploy", ".post"];

class StageDefinition {
  constructor(
    public name: string,
    public source: ScalarNode | null = null,
  ) {}
}

export interface IncludeResolver {
  findComponentFile(componentPath: string): GitlabFile | null;
  findProjectFile(
    projectPath: string,
    value: string,
    ref: string | null,
  ): GitlabFile | null;
}

export class GitlabFileValidator {
  constructor(
    private reporter: ErrorReporter,
    private includeResolver: IncludeResolver,
  ) {}

  validate(file: GitlabFile) {
    const context = new GitlabFileContext(file);
    this.validateVariables(file.variables?.value ?? null);
    this.validateIncludes(file, context);
    this.validateWorkflow(file);
    this.validateStages(file, context);
    this.validateJobs(file, context);
    return context;
  }

  private validateVariables(variables: VariableDefinition[] | null) {
    variables?.forEach((vdef) => {
      if (!vdef.name.value.match(/[a-zA-Z0-9_]+/)) {
        this.reporter.reportError(
          vdef.name.range,
          "should only contains: numbers, letters, and underscores (_)",
        );
      }
    });
  }

  private validateStages(file: GitlabFile, context: GitlabFileContext) {
    if (file.stages) {
      context.stages = [];
      context.stageByName = new Map();
      file.stages.value.elements.forEach((v) => {
        if (context.stageByName.has(v.value)) {
          this.reporter.reportError(v.range, "already defined stage");
        } else {
          context.addStage(v);
        }
      });
    }
  }

  private validateWorkflow(file: GitlabFile) {
    if (file.workflow) {
      if (file.workflow.value.rules) {
        this.validateRules(file.workflow.value.rules.value);
      }
    }
  }

  private checkOneOf(keys: string[], node: any) {
    let count = 0;
    let firstNode: ScalarNode;
    keys.forEach((n) => {
      if (node[n]) {
        count++;
        firstNode = (node[n] as MapItem<any>).keyNode;
      }
    });
    if (count == 0) {
      this.reporter.reportError(
        firstNode!.range,
        `must use one of: ${keys.join(", ")}`,
      );
      return false;
    }
    if (count > 1) {
      this.reporter.reportError(
        firstNode!.range,
        `must only use one of: ${keys.join(", ")}`,
      );
      return false;
    }
    return true;
  }

  private validateIncludes(file: GitlabFile, context: GitlabFileContext) {
    if (file.include) {
      file.include.value.forEach((include) => {
        const oneOfKeys = [
          "component",
          "local",
          "project",
          "remote",
          "template",
        ];
        if (this.checkOneOf(oneOfKeys, include)) {
          if (include.project) {
            if (!include.file) {
              this.reporter.reportError(
                include.project.keyNode.range,
                "file property must be defined",
              );
            } else {
              const projectPath = include.project.value.value;
              const ref = include.ref?.value.value ?? null;
              include.file.value.elements.forEach((file) => {
                const includedFile = this.includeResolver.findProjectFile(
                  projectPath,
                  file.value,
                  ref,
                );
                this.reporter.reportWarning(
                  file.range,
                  `TODO include::project(${projectPath} / ${file.value} / ${ref}) -> ${includedFile}`,
                );
              });
            }
          } else if (include.component) {
            const componentPath = include.component.value.value!;
            const includedFile =
              this.includeResolver.findComponentFile(componentPath);
            this.reporter.reportWarning(
              include.component.keyNode.range,
              `TODO include::component(${componentPath}) -> ${includedFile}`,
            );
          } else if (include.local) {
            this.reporter.reportWarning(
              include.local.keyNode.range,
              "TODO include::local",
            );
          } else if (include.remote) {
            this.reporter.reportWarning(
              include.remote.keyNode.range,
              "TODO include::remote",
            );
          } else if (include.template) {
            this.reporter.reportWarning(
              include.template.keyNode.range,
              "TODO include::template",
            );
          }
        }
        if (include.rules) {
          this.validateRules(include.rules.value);
        }
      });
    }
  }

  private validateRules(rules: Rule[]) {
    rules.forEach((rule) => {
      this.validateRule(rule);
    });
  }

  private validateRule(rule: Rule) {
    // TODO validation can change on context include/workflow/job
    // TODO one of if/changes/exists
    if (rule.if) {
      this.reporter.reportWarning(
        rule.if.value.range,
        `CHECK ${rule.if.value}`,
      );
    }
    if (rule.when) {
      const WHEN_VALUES = [
        "on_success",
        "on_failure",
        "never",
        "always",
        "manual",
        "delayed",
      ];
      if (!WHEN_VALUES.includes(rule.when.value.value)) {
        this.reporter.reportError(rule.when.value.range, "invalid value");
      }
    }
  }

  private validateJobs(file: GitlabFile, context: GitlabFileContext) {
    // TODO make lazy getter `getJobs()` in GitlabFileContext
    file.jobs.forEach((job) => {
      context.jobs.set(job.keyNode.value, job.value);
    });
    file.jobs.forEach((job) => {
      this.validateJob(job.value, context);
    });
  }

  private validateJob(job: Job, context: GitlabFileContext) {
    this.validateVariables(job.variables?.value ?? null);
    this.validateJobStage(job, context);
    this.validateJobExtends(job, context);
    this.validateNeeds(job, context);
    this.validateDependencies(job, context);
  }

  private validateJobStage(job: Job, context: GitlabFileContext) {
    const DEFAULT_STAGE = "test";
    const stage = job.stage?.value.value ?? DEFAULT_STAGE;
    if (!context.stageByName.has(stage)) {
      this.reporter.reportError(
        job.stage?.value.range ?? job.name.range,
        job.stage ? "unknown stage" : "unknown default stage test",
      );
    } else {
      if (job.stage) {
        // TODO add usage to StageDefinition
      }
    }
  }

  private validateJobExtends(job: Job, context: GitlabFileContext) {
    if (job.extends) {
      job.extends.value.elements.forEach((ext) => {
        if (!context.jobs.has(ext.value)) {
          this.reporter.reportError(ext.range, "unknown job");
        }
        if (ext.value === job.name.value) {
          this.reporter.reportError(ext.range, "job cannot extends itself");
        }
      });
    }
  }

  private validateNeeds(job: Job, context: GitlabFileContext) {
    job.needs?.value.elements.forEach((neededJob) => {
      if (!context.jobs.has(neededJob.value)) {
        this.reporter.reportError(neededJob.range, "unknown job");
      }
      if (neededJob.value === job.name.value) {
        this.reporter.reportError(
          neededJob.range,
          "job cannot depend on itself",
        );
      }
    });
  }

  private validateDependencies(job: Job, context: GitlabFileContext) {
    job.dependencies?.value.elements.forEach((dependentJobName) => {
      if (!context.jobs.has(dependentJobName.value)) {
        this.reporter.reportError(dependentJobName.range, "unknown job");
      }
      if (dependentJobName.value === job.name.value) {
        this.reporter.reportError(
          dependentJobName.range,
          "job cannot depend on itself",
        );
      }
      const dependentJob = context.jobs.get(dependentJobName.value)!;
      const firstStage = dependentJob.stage?.value.value; // TODO should use method stageName() to handle default
      const secondStage = job.stage?.value.value;
      if (firstStage && secondStage) {
        if (!context.isStageBefore(firstStage, secondStage)) {
          this.reporter.reportError(
            dependentJobName.range,
            "cannot depend on a job whose stage is not before",
          );
        }
      }
    });
    if (job.dependencies && job.needs) {
      this.reporter.reportWarning(
        job.dependencies.keyNode.range,
        "should not use dependencies with needs",
      );
    }
  }
}
