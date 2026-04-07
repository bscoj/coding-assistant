//#region ../packages/utils/src/databricks-host-utils.ts
/**
* Utility functions for handling Databricks host URLs
*/
/**
* Normalize Databricks host URL to ensure consistent format
* Supports both formats:
* - https://workspace.cloud.databricks.com/ (with protocol)
* - workspace.cloud.databricks.com (without protocol)
*/
function normalizeHost(host) {
	if (!host) throw new Error("Databricks host configuration required. Please set either:\n- DATABRICKS_HOST environment variable\n- DATABRICKS_CONFIG_PROFILE environment variable (with \"databricks auth login\" configured)");
	return host.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
/**
* Get the full HTTPS URL for a Databricks host
*/
function getHostUrl(host) {
	return `https://${normalizeHost(host || process.env.DATABRICKS_HOST)}`;
}
/**
* Get the normalized host without protocol
*/
function getHostDomain(host) {
	return normalizeHost(host || process.env.DATABRICKS_HOST);
}

//#endregion
//#region ../packages/utils/src/subprocess.ts
async function spawnWithOutput(command, args, options = {}) {
	const { env, errorMessagePrefix = `${command} failed` } = options;
	const { spawn } = await import("node:child_process");
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			env
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (data) => {
			stdout += data.toString();
		});
		child.stderr?.on("data", (data) => {
			stderr += data.toString();
		});
		child.on("close", (code) => {
			if (code !== 0) {
				reject(/* @__PURE__ */ new Error(`${errorMessagePrefix} (exit code ${code}): ${stderr.trim()}`));
				return;
			}
			resolve(stdout.trim());
		});
	});
}

//#endregion
export { getHostDomain as n, getHostUrl as r, spawnWithOutput as t };