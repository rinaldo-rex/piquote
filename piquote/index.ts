import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext, WorkingIndicatorOptions } from "@mariozechner/pi-coding-agent";
import { parse, stringify } from "yaml";

type QuoteEntry = {
	text: string;
	author?: string;
};

type Category = "tips" | "quotes" | "custom";

type PiquoteStyle = "minimal-1" | "minimal-2" | "balanced";

type LoadedConfig = {
	tips: QuoteEntry[];
	quotes: QuoteEntry[];
	custom: QuoteEntry[];
};

const DEFAULT_WORKING_MESSAGE = "working...";
const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "extensions", "piquote", "quotes.yaml");
const PROGRESS_FRAMES = ["▱▱▱▱", "▰▱▱▱", "▰▰▱▱", "▰▰▰▱", "▰▰▰▰"] as const;
const TYPEWRITER_STEP_MS = 70;
const TYPEWRITER_CHARS_PER_STEP = 1;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function pickRandom<T>(items: readonly T[]): T | undefined {
	if (items.length === 0) return undefined;
	return items[Math.floor(Math.random() * items.length)];
}

function normalizeEntries(value: unknown): QuoteEntry[] {
	if (!Array.isArray(value)) return [];

	const normalized: QuoteEntry[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const obj = entry as Record<string, unknown>;
		if (typeof obj.text !== "string") continue;
		const text = obj.text.trim();
		if (!text) continue;
		const author = typeof obj.author === "string" && obj.author.trim() ? obj.author.trim() : undefined;
		normalized.push({ text, author });
	}
	return normalized;
}

function formatEntry(category: Category, entry: QuoteEntry): string {
	if ((category === "quotes" || category === "custom") && entry.author) {
		return `${entry.text} — ${entry.author}`;
	}
	return entry.text;
}

function getRotationSeconds(text: string): number {
	return clamp(text.length / 8, 3, 12);
}

function styleDescription(style: PiquoteStyle): string {
	switch (style) {
		case "minimal-1":
			return "pulse indicator + static text";
		case "minimal-2":
			return "pulse indicator + progress trail";
		case "balanced":
			return "pulse indicator + typewriter reveal";
	}
}

function parseAddArgument(rawInput: string): { text: string; author?: string } | null {
	const trimmed = rawInput.trim();
	if (!trimmed) return null;

	// Split on the last "~" to separate text and author
	const lastTildeIndex = trimmed.lastIndexOf("~");
	if (lastTildeIndex === -1) {
		return { text: trimmed };
	}

	const textPart = trimmed.slice(0, lastTildeIndex).trim();
	const authorPart = trimmed.slice(lastTildeIndex + 1).trim();

	if (!textPart) return null;

	return { text: textPart, author: authorPart || undefined };
}

async function loadConfig(): Promise<LoadedConfig> {
	const raw = await readFile(CONFIG_PATH, "utf8");
	const parsed = parse(raw) as Record<string, unknown> | null;
	const tipsSection = parsed && typeof parsed === "object" ? (parsed.tips as Record<string, unknown> | undefined) : undefined;
	const quotesSection =
		parsed && typeof parsed === "object" ? (parsed.quotes as Record<string, unknown> | undefined) : undefined;
	const customSection =
		parsed && typeof parsed === "object" ? (parsed.custom as Record<string, unknown> | undefined) : undefined;

	return {
		tips: normalizeEntries(tipsSection?.items),
		quotes: normalizeEntries(quotesSection?.items),
		custom: normalizeEntries(customSection?.items),
	};
}

async function appendToCustom(entry: QuoteEntry): Promise<void> {
	// Ensure config directory exists
	await mkdir(path.dirname(CONFIG_PATH), { recursive: true });

	let config: Record<string, unknown>;

	try {
		const configRaw = await readFile(CONFIG_PATH, "utf8");
		config = parse(configRaw) as Record<string, unknown>;
	} catch (readError) {
		// If file doesn't exist or is invalid, start fresh
		config = {};
	}

	// Ensure structure exists
	if (!config.custom) {
		config.custom = { items: [] };
	} else if (!Array.isArray((config.custom as Record<string, unknown>).items)) {
		(config.custom as Record<string, unknown>).items = [];
	}

	const customItems = (config.custom as Record<string, unknown>).items as QuoteEntry[];
	customItems.push(entry);

	const yamlString = stringify(config, null, 2);
	await writeFile(CONFIG_PATH, yamlString, "utf8");
}

export default function (pi: ExtensionAPI) {
	let rotationTimer: NodeJS.Timeout | undefined;
	let effectTimer: NodeJS.Timeout | undefined;
	let effectVersion = 0;
	let activeCtx: ExtensionContext | undefined;
	let warnedConfigIssue = false;
	let styleMode: PiquoteStyle = "balanced";
	let currentBaseMessage = DEFAULT_WORKING_MESSAGE;

	const stopRotation = () => {
		if (rotationTimer) {
			clearTimeout(rotationTimer);
			rotationTimer = undefined;
		}
	};

	const stopTextEffect = () => {
		effectVersion++;
		if (effectTimer) {
			clearTimeout(effectTimer);
			effectTimer = undefined;
		}
	};

	const stopAll = () => {
		stopRotation();
		stopTextEffect();
	};

	const warnOnce = (ctx: ExtensionContext, message: string) => {
		if (warnedConfigIssue) return;
		warnedConfigIssue = true;
		console.warn(`[piquote] ${message}`);
		if (ctx.hasUI) {
			ctx.ui.notify(message, "warning");
		}
	};

	const pickMessage = async (ctx: ExtensionContext): Promise<string> => {
		try {
			const config = await loadConfig();
			const categories: Category[] = [];
			if (config.tips.length > 0) categories.push("tips");
			if (config.quotes.length > 0) categories.push("quotes");
			if (config.custom.length > 0) categories.push("custom");

			if (categories.length === 0) {
				warnOnce(
					ctx,
					`No valid tips/quotes found in ${CONFIG_PATH}. Falling back to "${DEFAULT_WORKING_MESSAGE}".`,
				);
				return DEFAULT_WORKING_MESSAGE;
			}

			const category = pickRandom(categories)!;
			const entry = pickRandom(config[category]);
			if (!entry) return DEFAULT_WORKING_MESSAGE;
			return formatEntry(category, entry);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			warnOnce(
				ctx,
				`Could not read ${CONFIG_PATH} (${reason}). Falling back to "${DEFAULT_WORKING_MESSAGE}".`,
			);
			return DEFAULT_WORKING_MESSAGE;
		}
	};

	const getPulseIndicator = (ctx: ExtensionContext): WorkingIndicatorOptions => ({
		frames: [
			ctx.ui.theme.fg("dim", "◌"),
			ctx.ui.theme.fg("muted", "○"),
			ctx.ui.theme.fg("accent", "◍"),
			ctx.ui.theme.fg("accent", "●"),
			ctx.ui.theme.fg("accent", "◍"),
			ctx.ui.theme.fg("muted", "○"),
		],
		intervalMs: 120,
	});

	const applyWorkingIndicator = (ctx: ExtensionContext) => {
		ctx.ui.setWorkingIndicator(getPulseIndicator(ctx));
	};

	const startTextEffect = (ctx: ExtensionContext, baseMessage: string) => {
		stopTextEffect();
		const thisEffect = effectVersion;

		if (styleMode === "minimal-1") {
			ctx.ui.setWorkingMessage(baseMessage);
			return;
		}

		if (styleMode === "minimal-2") {
			let frame = 0;
			ctx.ui.setWorkingMessage(`${baseMessage} ${PROGRESS_FRAMES[frame]}`);
			const tick = () => {
				if (thisEffect !== effectVersion) return;
				if (!activeCtx || activeCtx.isIdle()) {
					stopTextEffect();
					// Restore full message (without progress indicator)
					if (activeCtx && currentBaseMessage) {
						activeCtx.ui.setWorkingMessage(currentBaseMessage);
					}
					return;
				}
				frame = (frame + 1) % PROGRESS_FRAMES.length;
				ctx.ui.setWorkingMessage(`${baseMessage} ${PROGRESS_FRAMES[frame]}`);
				effectTimer = setTimeout(tick, 220);
			};
			tick();
			return;
		}

		if (ctx.isIdle()) {
			ctx.ui.setWorkingMessage(baseMessage);
			return;
		}

		const chars = Array.from(baseMessage);
		let index = Math.min(TYPEWRITER_CHARS_PER_STEP, chars.length);
		ctx.ui.setWorkingMessage(chars.slice(0, index).join(""));
		if (index >= chars.length) return;

		const tick = () => {
			if (thisEffect !== effectVersion) return;
			if (!activeCtx || activeCtx.isIdle()) {
				stopTextEffect();
				// Restore full message
				if (activeCtx && currentBaseMessage) {
					activeCtx.ui.setWorkingMessage(currentBaseMessage);
				}
				return;
			}
			index = Math.min(chars.length, index + TYPEWRITER_CHARS_PER_STEP);
			ctx.ui.setWorkingMessage(chars.slice(0, index).join(""));
			if (index >= chars.length) {
				stopTextEffect();
				return;
			}
			effectTimer = setTimeout(tick, TYPEWRITER_STEP_MS);
		};

		effectTimer = setTimeout(tick, TYPEWRITER_STEP_MS);
	};

	const renderCurrentMessage = (ctx: ExtensionContext) => {
		// Indicator is set once at session start; don't reapply on each rotation to avoid stutter
		startTextEffect(ctx, currentBaseMessage);
	};

	const scheduleNext = async (ctx: ExtensionContext) => {
		activeCtx = ctx;
		currentBaseMessage = await pickMessage(ctx);
		renderCurrentMessage(ctx);

		const delayMs = Math.round(getRotationSeconds(currentBaseMessage) * 1000);
		rotationTimer = setTimeout(() => {
			if (!activeCtx || activeCtx.isIdle()) {
				stopAll();
				// Restore full message if we're stopping due to idle
				if (activeCtx && currentBaseMessage) {
					activeCtx.ui.setWorkingMessage(currentBaseMessage);
				}
				return;
			}
			void scheduleNext(activeCtx);
		}, delayMs);
	};

	const startRotation = async (ctx: ExtensionContext) => {
		stopAll();
		await scheduleNext(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		activeCtx = ctx;
		ctx.ui.setWorkingMessage(DEFAULT_WORKING_MESSAGE);
		applyWorkingIndicator(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		await startRotation(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		stopAll();
		activeCtx = ctx;
		// Ensure full message is shown if typewriter was interrupted
		if (currentBaseMessage) {
			ctx.ui.setWorkingMessage(currentBaseMessage);
		}
	});

	pi.on("session_shutdown", async () => {
		stopAll();
		activeCtx = undefined;
	});

	pi.registerCommand("piquote-reload", {
		description: "Reload piquote YAML config and preview one random message",
		handler: async (_args, ctx) => {
			warnedConfigIssue = false;
			currentBaseMessage = await pickMessage(ctx);
			renderCurrentMessage(ctx);
			ctx.ui.notify(`piquote loaded: ${currentBaseMessage}`, "info");
		},
	});

	pi.registerCommand("piquote-style", {
		description: "Set piquote style with a selector modal",
		getArgumentCompletions: (prefix) => {
			const styles: PiquoteStyle[] = ["minimal-1", "minimal-2", "balanced"];
			const filtered = styles.filter((style) => style.startsWith(prefix.toLowerCase()));
			return filtered.length > 0 ? filtered.map((style) => ({ value: style, label: style })) : null;
		},
		handler: async (args, ctx) => {
			const parsed = args.trim().toLowerCase();
			const directArg =
				parsed === "minimal-1" || parsed === "minimal-2" || parsed === "balanced"
					? (parsed as PiquoteStyle)
					: undefined;

			const options: Array<{ mode: PiquoteStyle; label: string }> = [
				{ mode: "minimal-1", label: "minimal-1 — pulse + static  (e.g. \"Ship small changes.\")" },
				{ mode: "minimal-2", label: "minimal-2 — pulse + trail   (e.g. \"Ship small changes. ▰▰▱▱\")" },
				{ mode: "balanced", label: "balanced — pulse + reveal   (e.g. \"Ship sm...\" -> \"Ship small changes.\")" },
			];

			let nextStyle = directArg;
			if (!nextStyle) {
				if (!ctx.hasUI) {
					ctx.ui.notify("In non-interactive mode, pass an argument: /piquote-style minimal-1|minimal-2|balanced", "error");
					return;
				}
				const selectedLabel = await ctx.ui.select("Choose piquote style", options.map((o) => o.label));
				if (!selectedLabel) return;
				nextStyle = options.find((o) => o.label === selectedLabel)?.mode;
				if (!nextStyle) return;
			}

			styleMode = nextStyle;
			if (!ctx.isIdle()) {
				renderCurrentMessage(ctx);
			} else {
				applyWorkingIndicator(ctx);
			}
			ctx.ui.notify(`piquote style set: ${styleMode} (${styleDescription(styleMode)})`, "info");
		},
	});

	pi.registerCommand("piquote-add", {
		description: "Add a custom quote to ~/.pi/agent/extensions/piquote/quotes.yaml under the 'custom' category. Usage: /piquote-add \"text ~author\" (author optional) or /piquote-add \"text\"",
		handler: async (args, ctx) => {
			const parsed = parseAddArgument(args);
			if (!parsed) {
				ctx.ui.notify('Invalid input. Usage: /piquote-add "Don\'t tell me you\'re reading all the above text! ~Rex" or /piquote-add "Just some text"', "error");
				return;
			}

			try {
				await appendToCustom({ text: parsed.text, author: parsed.author });
				const display = parsed.author ? `${parsed.text} — ${parsed.author}` : parsed.text;
				ctx.ui.notify(`✓ Added to custom: ${display}`, "success");
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to add custom quote: ${reason}`, "error");
			}
		},
	});
}
