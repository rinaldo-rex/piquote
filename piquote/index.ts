import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { parse } from "yaml";

type QuoteEntry = {
	text: string;
	author?: string;
};

type Category = "tips" | "quotes";

type LoadedConfig = {
	tips: QuoteEntry[];
	quotes: QuoteEntry[];
};

const DEFAULT_WORKING_MESSAGE = "working...";
const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "piquote", "quotes.yaml");
const HOLD_AFTER_RESPONSE_MS = 1500;

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
	let timer: NodeJS.Timeout | undefined;
	let holdTimer: NodeJS.Timeout | undefined;
	let activeCtx: ExtensionContext | undefined;
	let warnedConfigIssue = false;
	let lastShownMessage = DEFAULT_WORKING_MESSAGE;

	const stopRotation = () => {
		if (timer) {
			clearTimeout(timer);
			timer = undefined;
		}
	};

	const clearHold = (ctx?: ExtensionContext) => {
		if (holdTimer) {
			clearTimeout(holdTimer);
			holdTimer = undefined;
		}
		if (ctx) {
			ctx.ui.setStatus("piquote-hold", undefined);
		}
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

	const scheduleNext = async (ctx: ExtensionContext) => {
		activeCtx = ctx;
		const message = await pickMessage(ctx);
		lastShownMessage = message;
		ctx.ui.setWorkingMessage(message);
		const delayMs = Math.round(getRotationSeconds(message) * 1000);
		timer = setTimeout(() => {
			if (!activeCtx || activeCtx.isIdle()) {
				stopRotation();
				return;
			}
			void scheduleNext(activeCtx);
		}, delayMs);
	};

	const startRotation = async (ctx: ExtensionContext) => {
		clearHold(ctx);
		stopRotation();
		await scheduleNext(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		activeCtx = ctx;
		clearHold(ctx);
		lastShownMessage = DEFAULT_WORKING_MESSAGE;
		ctx.ui.setWorkingMessage(DEFAULT_WORKING_MESSAGE);
	});

	pi.on("agent_start", async (_event, ctx) => {
		await startRotation(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		stopRotation();
		activeCtx = ctx;

		ctx.ui.setStatus("piquote-hold", ctx.ui.theme.fg("dim", lastShownMessage));
		holdTimer = setTimeout(() => {
			activeCtx?.ui.setStatus("piquote-hold", undefined);
			holdTimer = undefined;
		}, HOLD_AFTER_RESPONSE_MS);
	});

	pi.on("session_shutdown", async () => {
		stopRotation();
		clearHold(activeCtx);
		activeCtx = undefined;
	});

	pi.registerCommand("piquote-reload", {
		description: "Reload piquote YAML config and preview one random message",
		handler: async (_args, ctx) => {
			warnedConfigIssue = false;
			const message = await pickMessage(ctx);
			lastShownMessage = message;
			ctx.ui.setWorkingMessage(message);
			ctx.ui.notify(`piquote loaded: ${message}`, "info");
		},
	});
}
