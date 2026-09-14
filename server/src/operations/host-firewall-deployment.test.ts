import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const firewallScriptPath = resolve(process.cwd(), "../deploy/configure-host-firewall.sh");
const firewallManualPath = resolve(process.cwd(), "../deploy/HOST_FIREWALL.md");
const bundleScriptPath = resolve(process.cwd(), "scripts/create-hosting-deployment-bundle.mjs");

describe("host firewall deployment", () => {
  it("defaults to a read-only plan and requires an exact apply confirmation", async () => {
    const script = await readFile(firewallScriptPath, "utf8");

    expect(script).toContain("APPLY=false");
    expect(script).toContain("if [[ \"$APPLY\" != true ]]");
    expect(script).toContain("ACTIVATE_HOST_FIREWALL");
    expect(script).toContain("HOST_FIREWALL_CONFIRMATION_REQUIRED");
    expect(script).toContain("HOST_FIREWALL_ROOT_REQUIRED");
  });

  it("verifies active services and permits SSH before enabling UFW", async () => {
    const script = await readFile(firewallScriptPath, "utf8");
    const sshService = script.indexOf("systemctl is-active --quiet ssh");
    const nginxService = script.indexOf("systemctl is-active --quiet nginx");
    const allowSsh = script.indexOf('ufw allow "${SSH_PORT}/tcp"');
    const denyIncoming = script.indexOf("ufw default deny incoming");
    const enableFirewall = script.indexOf("ufw --force enable");

    expect(sshService).toBeGreaterThan(-1);
    expect(nginxService).toBeGreaterThan(-1);
    expect(allowSsh).toBeGreaterThan(nginxService);
    expect(denyIncoming).toBeGreaterThan(allowSsh);
    expect(enableFirewall).toBeGreaterThan(denyIncoming);
    expect(script).toContain("HOST_FIREWALL_ACTIVE_SSH_PORT_MISMATCH");
    expect(script).toContain("80/tcp comment 'HanStone HTTP'");
    expect(script).toContain("443/tcp comment 'HanStone HTTPS'");
  });

  it("backs up and restores UFW rules when application fails", async () => {
    const script = await readFile(firewallScriptPath, "utf8");

    expect(script).toContain("/var/backups/hanstone-firewall");
    expect(script).toContain("cp -a -- \"/etc/ufw/${rules_file}\"");
    expect(script).toContain("trap rollback_on_error ERR");
    expect(script).toContain("ufw --force disable");
    expect(script).not.toContain("ufw reset");
    expect(script).not.toMatch(/\brm\s/u);
  });

  it("ships the confirmation tool and its operator manual in deployment bundles", async () => {
    const [bundle, manual] = await Promise.all([
      readFile(bundleScriptPath, "utf8"),
      readFile(firewallManualPath, "utf8"),
    ]);

    expect(bundle).toContain('"deploy/configure-host-firewall.sh"');
    expect(bundle).toContain('"deploy/HOST_FIREWALL.md"');
    expect(manual).toContain("기존 세션을 닫기 전에 새 터미널에서 SSH 재접속");
    expect(manual).toContain("`ufw reset`은 실행하지 않습니다.");
  });
});
