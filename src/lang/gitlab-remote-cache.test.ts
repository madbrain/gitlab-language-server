import { describe, expect, test } from "vitest";
import { GitlabRemoteCache } from "./gitlab-remote-cache";
import { URI } from "vscode-uri";

describe("GitlabRemoteCache", () => {
  test("test project file cache", async () => {
    const gitlabRemoteCache = new GitlabRemoteCache(
      "test/gitlab-remote-cache",
      "https://gitlab.gnome.org",
      { log: console.log },
    );

    const result = await gitlabRemoteCache.getProjectFile(
      "gnome/citemplates",
      "flatpak/flatpak_ci_initiative.yml",
    );
    expect(result).is.not.null;
    expect(result!.path).toEqual(
      "test/gitlab-remote-cache/projects/gnome/citemplates/HEAD/flatpak/flatpak_ci_initiative.yml",
    );
    expect(result!.content).is.not.null;
  });
});
