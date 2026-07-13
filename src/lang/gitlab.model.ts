import { ListNode, ScalarNode } from "./generic-model";

export class GitlabFile {
  includes: Include[] = [];
  stages: ListNode | null = null;
  jobs: Job[] = [];
}

export class Include {
  local: ScalarNode | null = null;
  constructor(public name: ScalarNode) {}
}

export class Job {
  stage: ScalarNode | null = null;
  script: ListNode | null = null;
  needs: ListNode | null = null;
  extends: ListNode | null = null;
  constructor(public name: ScalarNode) {}
}
