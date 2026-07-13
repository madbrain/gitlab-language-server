import { ErrorReporter } from "./error-reporter";
import { GitlabFile } from "./gitlab.model";

export class GitlabFileValidator {
  constructor(private reporter: ErrorReporter) {}
  validate(file: GitlabFile) {
    this.validateExtends(file);
    this.validateStages(file);
    this.validateNeeds(file);
  }

  private validateExtends(file: GitlabFile) {
    // TODO job.extends references valid job (normal and template)
  }

  private validateStages(file: GitlabFile) {
    const DEFAULT_STAGES = [".pre", "build", "test", "deploy", ".post"];
    const DEFAULT_STAGE = "test";

    const stages = file.stages?.elements.map((v) => v.value) ?? DEFAULT_STAGES;
    file.jobs.forEach((job) => {
      const stage = job.stage?.value ?? DEFAULT_STAGE;
      if (!stages.includes(stage)) {
        this.reporter.reportError(
          job.stage?.range ?? job.name.range,
          job.stage ? "unknown stage" : "unknown default stage test",
        );
      }
    });
  }

  private validateNeeds(file: GitlabFile) {
    // TODO job.needs references existing job name
  }
}
