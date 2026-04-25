import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext, WorkingIndicatorOptions } from "@mariozechner/pi-coding-agent";
import { parse } from "yaml";

type QuoteEntry = {
	text: string;
	author?: string;
};

type Category = "tips" | "quotes";
type PiquoteStyle = "minimal-1" | "minimal-2" | "balanced";

type LoadedConfig = {
	tips: QuoteEntry[];
	quotes: QuoteEntry[];
};

const DEFAULT_WORKING_MESSAGE = "working...";
const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "piquote", "quotes.yaml");
const PROGRESS_FRAMES = ["▱▱▱▱", "▰▱▱▱", "▰▰▱▱", "▰▰▰▱", "▰▰▰▰"] as const;

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
	if (category === "quotes" && entry.author) {
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

async function loadConfig(): Promise<LoadedConfig> {
	const raw = await readFile(CONFIG_PATH, "utf8");
	const parsed = parse(raw) as Record<string, unknown> | null;
	const tipsSection = parsed && typeof parsed === "object" ? (parsed.tips as Record<string, unknown> | undefined) : undefined;
	const quotesSection =
		parsed && typeof parsed === "object" ? (parsed.quotes as Record<string, unknown> | undefined) : undefined;

	return {
		tips: normalizeEntries(tipsSection?.items),
		quotes: normalizeEntries(quotesSection?.items),
	};
}

export default function (pi: ExtensionAPI) {
	let rotationTimer: NodeJS.Timeout | undefined;
	let effectTimer: NodeJS.Timeout | undefined;
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
		if (effectTimer) {
			clearInterval(effectTimer);
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

			if (categories.length === 0) {
				warnOnce(
					ctx,
					`No valid tips/quotes found in ${CONFIG_PATH}. Falling back to \"${DEFAULT_WORKING_MESSAGE}\".`,
				);
				return DEFAULT_WORKING_MESSAGE;
			}

			const category = pickRandom(categories)!;
			const entry = pickRandom(config[category]);
			if (!entry) {
				return DEFAULT_WORKING_MESSAGE;
			}
			return formatEntry(category, entry);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			warnOnce(
				ctx,
				`Could not read ${CONFIG_PATH} (${reason}). Falling back to \"${DEFAULT_WORKING_MESSAGE}\".`,
			);
			return DEFAULT_WORKING_MESSAGE;
		}
	};

	const getPulseIndicator = (ctx: ExtensionContext): WorkingIndicatorOptions => ({
		frames: [
			ctx.ui.theme.fg("dim", "·"),
			ctx.ui.theme.fg("muted", "•"),
			ctx.ui.theme.fg("accent", "●"),
			ctx.ui.theme.fg("muted", "•"),
		],
		intervalMs: 120,
	});

	const applyWorkingIndicator = (ctx: ExtensionContext) => {
		ctx.ui.setWorkingIndicator(getPulseIndicator(ctx));
	};

	const startTextEffect = (ctx: ExtensionContext, baseMessage: string) => {
		stopTextEffect();

		if (styleMode === "minimal-1") {
			ctx.ui.setWorkingMessage(baseMessage);
			return;
		}

		if (styleMode === "minimal-2") {
			let frame = 0;
			ctx.ui.setWorkingMessage(`${baseMessage} ${PROGRESS_FRAMES[frame]}`);
			effectTimer = setInterval(() => {
				if (!activeCtx || activeCtx.isIdle()) {
					stopTextEffect();
					return;
				}
				frame = (frame + 1) % PROGRESS_FRAMES.length;
				ctx.ui.setWorkingMessage(`${baseMessage} ${PROGRESS_FRAMES[frame]}`);
			}, 220);
			return;
		}

		const chars = Array.from(baseMessage);
		let index = 0;
		ctx.ui.setWorkingMessage("");
		effectTimer = setInterval(() => {
			if (!activeCtx || activeCtx.isIdle()) {
				stopTextEffect();
				return;
			}

			index = Math.min(chars.length, index + 1);
			ctx.ui.setWorkingMessage(chars.slice(0, index).join(""));
			if (index >= chars.length) {
				stopTextEffect();
			}
		}, 55);
	};

	const renderCurrentMessage = (ctx: ExtensionContext) => {
		applyWorkingIndicator(ctx);
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
}
