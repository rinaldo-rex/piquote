import { mkdir, access, copyFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function main() {
	const home = os.homedir();
	if (!home) {
		console.warn("[piquote] postinstall: could not determine home directory; skipping config bootstrap.");
		return;
	}

	const targetDir = path.join(home, ".pi", "agent", "piquote");
	const targetFile = path.join(targetDir, "quotes.yaml");
	const sourceFile = path.join(process.cwd(), "piquote", "quotes.yaml.example");

	try {
		await mkdir(targetDir, { recursive: true });
	} catch (error) {
		console.warn(`[piquote] postinstall: failed to create ${targetDir}: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	try {
		await access(targetFile);
		console.log(`[piquote] postinstall: config already exists at ${targetFile}; leaving it unchanged.`);
		return;
	} catch {
		// File does not exist, proceed.
	}

	try {
		await copyFile(sourceFile, targetFile);
		console.log(`[piquote] postinstall: created default config at ${targetFile}`);
	} catch (error) {
		console.warn(
			`[piquote] postinstall: failed to copy example config from ${sourceFile} to ${targetFile}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

await main();
