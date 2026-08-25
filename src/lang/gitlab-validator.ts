import { ErrorReporter, NullReporter } from "./error-reporter";
import {
  ComponentSpec,
  GitlabFile,
  Include,
  Job,
  Rule,
  VariableDefinition,
} from "./gitlab.model";
import { MapItem, ScalarNode } from "./generic-model";
import { GitlabService, LocalFile } from "./gitlabci";
import { ParsedNode } from "yaml";
import * as path from "path";
import { ParsedGitlabFile } from "./gitlab-builder";
import { expandText } from "./variable-expander";
import { URI } from "vscode-uri";
import { TemplateParser, TextTemplate } from "./template-parser";

export class GitlabFileContext {
  stages = DEFAULT_STAGES;
  stageByName: Map<string, StageDefinition> = new Map(
    DEFAULT_STAGES.map((n) => [n, new StageDefinition(n)]),
  );
  jobs = new Map<string, Job>();
  includedContexts: GitlabFileContext[] = [];

  constructor(
    public uri: string,
    public root: ParsedNode | null,
    public mainFile: GitlabFile,
    public spec: ComponentSpec | null = null,
  ) {}

  findJob(name: string): Job | null {
    const job = this.jobs.get(name);
    if (job) {
      return job;
    }
    for (const includedContext of this.includedContexts.reverse()) {
      const job = includedContext.findJob(name);
      if (job) {
        return job;
      }
    }
    return null;
  }

  addStage(stageName: string, stage: ScalarNode | null = null) {
    this.stages.push(stageName);
    this.stageByName.set(stageName, new StageDefinition(stageName, stage));
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
  findLocalFile(value: string): Promise<LocalFile | null>;
  findComponentFile(componentPath: string): Promise<LocalFile | null>;
  findProjectFile(
    projectPath: string,
    value: string,
    ref: string | null,
  ): Promise<LocalFile | null>;
}

export interface VariablesProvider {
  getProjectVariables(): Promise<{ [name: string]: string }>;
}

export class GitlabFileValidator {
  constructor(
    private reporter: ErrorReporter,
    private includeResolver: IncludeResolver,
    private variablesProvider: VariablesProvider,
    private gitlabService: GitlabService,
  ) {}

  async validate(parsedFile: ParsedGitlabFile, spec: ComponentSpec | null) {
    const file = parsedFile.file;
    const context = new GitlabFileContext(
      parsedFile.uri,
      parsedFile.root,
      file,
      spec,
    );
    this.validateVariables(file.variables?.value ?? null);
    await this.validateIncludes(file, context);
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
      context.addStage(".pre");
      file.stages.value.elements.forEach((v) => {
        if (context.stageByName.has(v.value)) {
          this.reporter.reportError(v.range, "duplicated stage");
        } else {
          context.addStage(v.value, v);
        }
      });
      context.addStage(".post");
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

  private async validateIncludes(file: GitlabFile, context: GitlabFileContext) {
    if (!file.include) {
      return;
    }
    for (const include of file.include.value) {
      await this.validateInclude(include, context);
    }
  }

  private async validateInclude(include: Include, context: GitlabFileContext) {
    const oneOfKeys = ["component", "local", "project", "remote", "template"];
    if (this.checkOneOf(oneOfKeys, include)) {
      if (include.project) {
        await this.validateIncludeProject(include, include.project, context);
      } else if (include.component) {
        await this.validateIncludeComponent(
          include,
          include.component,
          context,
        );
      } else if (include.local) {
        await this.validateLocalInclude(include, include.local, context);
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
  }

  private async validateIncludeProject(
    include: Include,
    project: MapItem<TextTemplate>,
    context: GitlabFileContext,
  ) {
    if (!include.file) {
      this.reporter.reportError(
        project.keyNode.range,
        "file property must be defined",
      );
      return;
    }
    const envs = await this.variablesProvider.getProjectVariables();
    const projectPath = project.value.expandText(envs);
    const ref = include.ref?.value.expandText(envs) ?? null;
    for (const file of include.file.value.elements) {
      const includedFile = await this.includeResolver.findProjectFile(
        projectPath,
        file.expandText(envs),
        ref,
      );
      if (!includedFile) {
        // TODO add more info on why it cannot be resolved
        this.reporter.reportWarning(file.range, `cannot resolve include`);
      } else {
        const includedGitlabFile = await this.gitlabService.validateDocument(
          "file:" + includedFile.path,
          includedFile.content,
          NullReporter,
        );
        if (!includedGitlabFile) {
          this.reporter.reportWarning(
            file.range,
            `file is not a valid yaml file`,
          );
        } else {
          include.context = includedGitlabFile;
          context.includedContexts.push(includedGitlabFile);
        }
      }
    }
  }

  private async validateIncludeComponent(
    include: Include,
    component: MapItem<TextTemplate>,
    context: GitlabFileContext,
  ) {
    const envs = await this.variablesProvider.getProjectVariables();
    const componentPath = component.value.expandText(envs);
    const includedFile =
      await this.includeResolver.findComponentFile(componentPath);
    if (!includedFile) {
      // TODO add more info on why it cannot be resolved
      this.reporter.reportWarning(
        component.value.range,
        `cannot resolve include`,
      );
    } else {
      const includedGitlabFile = await this.gitlabService.validateDocument(
        "file:" + includedFile.path,
        includedFile.content,
        NullReporter,
      );
      if (!includedGitlabFile || !includedGitlabFile.spec) {
        this.reporter.reportWarning(
          component.value.range,
          `file is not a valid component file`,
        );
      } else {
        include.context = includedGitlabFile;
        const inputs = include.inputs;

        // TODO externalize inputs validation
        if (inputs) {
          const args: { [name: string]: string } = {};
          const spec = includedGitlabFile.spec;
          spec.inputs.forEach((is) => {
            if (is.value.default) {
              args[is.keyNode.value] = is.value.default.value.value;
            }
          });
          inputs.value.forEach((input) => {
            const inputSpec = spec.findInput(input.name.value);
            if (!inputSpec) {
              this.reporter.reportError(input.name.range, `unknown input`);
            } else {
              if (inputSpec.value.type) {
                this.reporter.reportWarning(
                  input.value.range,
                  `TODO check type is ${inputSpec.value.type.value.value})`,
                );
              }
              if (inputSpec.value.regex) {
                this.reporter.reportWarning(
                  input.value.range,
                  `TODO check type is ${inputSpec.value.regex.value.value})`,
                );
              }
              if (inputSpec.value.option) {
                const possibleOptions =
                  inputSpec.value.option.value.elements.map((v) => v.value);
                if (!possibleOptions.includes(input.value.value)) {
                  this.reporter.reportWarning(
                    input.value.range,
                    `unexpected value, possible options: ${possibleOptions.join(", ")})`,
                  );
                }
              }
              args[input.name.value] = input.value.value;
            }
          });
          const missingRequiredArgs = spec.inputs
            .filter((is) => args[is.keyNode.value] === undefined)
            .map((is) => is.keyNode.value);

          if (missingRequiredArgs.length > 0) {
            this.reporter.reportWarning(
              inputs.keyNode.range,
              `missing required inputs: ${missingRequiredArgs.join(", ")}`,
            );
          } else {
            // TODO evaluate component with args
            // TODO add evaluated file to context context.includedContexts.push(includedGitlabFile);
            this.reporter.reportWarning(
              component.value.range,
              `TODO include::component(${includedFile.path})`,
            );
          }
        }
      }
    }
  }

  private async validateLocalInclude(
    include: Include,
    local: MapItem<TextTemplate>,
    context: GitlabFileContext,
  ) {
    const envs = await this.variablesProvider.getProjectVariables();
    const localPath = path.join(
      path.dirname(URI.parse(context.uri).fsPath),
      local.value.expandText(envs),
    );

    const includedFile = await this.includeResolver.findLocalFile(localPath);
    if (!includedFile) {
      this.reporter.reportWarning(local.value.range, `cannot resolve include`);
      return;
    }

    const includedGitlabFile = await this.gitlabService.validateDocument(
      "file:" + includedFile.path,
      includedFile.content,
      NullReporter,
    );
    if (!includedGitlabFile) {
      this.reporter.reportWarning(
        local.value.range,
        `file is not a valid file`,
      );
      return;
    }

    // TODO validate inputs if present
    this.reporter.reportWarning(
      local.keyNode.range,
      `TODO ${includedGitlabFile.uri}`,
    );
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
    this.validateJobExtends(job, context);
    this.validateVariables(job.variables?.value ?? null);
    this.validateJobStage(job, context);
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
        const otherJob = context.findJob(ext.value);
        if (!otherJob) {
          this.reporter.reportError(ext.range, "unknown job");
        } else if (otherJob === job) {
          this.reporter.reportError(ext.range, "job cannot extends itself");
        } else {
          job.extenders.push(otherJob);
        }
      });
    }
  }

  private validateNeeds(job: Job, context: GitlabFileContext) {
    job.needs?.value.forEach((neededJob) => {
      const neededJobName = neededJob.job.value;
      const otherJob = context.findJob(neededJobName.value);
      if (!otherJob) {
        this.reporter.reportError(neededJobName.range, "unknown job");
      }
      if (neededJobName.value === job.name.value) {
        this.reporter.reportError(
          neededJobName.range,
          "job cannot depend on itself",
        );
      }
    });
  }

  private validateDependencies(job: Job, context: GitlabFileContext) {
    job.dependencies?.value.elements.forEach((dependentJobName) => {
      const dependentJob = context.findJob(dependentJobName.value);
      if (!dependentJob) {
        this.reporter.reportError(dependentJobName.range, "unknown job");
      } else {
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
      }
      if (dependentJobName.value === job.name.value) {
        this.reporter.reportError(
          dependentJobName.range,
          "job cannot depend on itself",
        );
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
