import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SOLO_RELEASE_CONFIRMATION,
  SOLO_RELEASE_OPERATOR_LOGIN,
} from "../common/release-approval-policy.js";

const workflowPaths = [
  "release-candidate-acceptance.yml",
  "production-deployment-verification.yml",
  "release-closeout.yml",
] as const;

describe("solo production release workflow policy", () => {
  for (const workflowName of workflowPaths) {
    it(`${workflowName} binds manual execution to the designated solo operator and confirmation`, () => {
      const workflow = readFileSync(
        resolve(process.cwd(), `../.github/workflows/${workflowName}`),
        "utf8",
      );

      expect(workflow).toContain("solo_release_confirmation:");
      expect(workflow).toContain("required: true");
      expect(workflow).toContain("SOLO_RELEASE_ACTOR: ${{ github.actor }}");
      expect(workflow).toContain("SOLO_RELEASE_CONFIRMATION: ${{ inputs.solo_release_confirmation }}");
      expect(workflow).toContain(`[[ \"$SOLO_RELEASE_ACTOR\" == \"${SOLO_RELEASE_OPERATOR_LOGIN}\" ]]`);
      expect(workflow).toContain(`[[ \"$SOLO_RELEASE_CONFIRMATION\" == \"${SOLO_RELEASE_CONFIRMATION}\" ]]`);
      expect(workflow).toContain("environment: production");
    });
  }
});
