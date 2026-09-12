/**
 * Tools Extension
 *
 * Provides a /tools command to enable/disable tools interactively.
 * Tool selection persists across session reloads and respects branch navigation.
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/extensions/ or your project's .pi/extensions/
 * 2. Use /tools to open the tool selector
 */

import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";

// State persisted to session
interface ToolsState {
	enabledTools: string[];
}

export default function toolsExtension(pi: ExtensionAPI) {
	// Track enabled tools
	let enabledTools: Set<string> = new Set();
	let allTools: ToolInfo[] = [];

	// Persist current state
	function persistState() {
		pi.appendEntry<ToolsState>("tools-config", {
			enabledTools: Array.from(enabledTools),
		});
	}

	// Apply current tool selection
	function applyTools() {
		pi.setActiveTools(Array.from(enabledTools));
	}

	// Find the last tools-config entry in the current branch
	function restoreFromBranch(ctx: ExtensionContext) {
		allTools = pi.getAllTools();

		// Get entries in current branch only
		const branchEntries = ctx.sessionManager.getBranch();
		let savedTools: string[] | undefined;

		for (const entry of branchEntries) {
			if (entry.type === "custom" && entry.customType === "tools-config") {
				const data = entry.data as ToolsState | undefined;
				if (data?.enabledTools) {
					savedTools = data.enabledTools;
				}
			}
		}

		if (savedTools) {
			// Restore saved tool selection (filter to only tools that still exist)
			const allToolNames = allTools.map((t) => t.name);
			enabledTools = new Set(savedTools.filter((t: string) => allToolNames.includes(t)));
			applyTools();
		} else {
			// No saved state - sync with currently active tools
			enabledTools = new Set(pi.getActiveTools());
		}
	}

	// Register /tools command
	pi.registerCommand("tools", {
		description: "Enable/disable tools",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/tools requires TUI mode", "error");
				return;
			}

			// Refresh tool list
			allTools = pi.getAllTools();

			await ctx.ui.custom((tui, theme, _kb, done) => {
				let lastToolCount = 0;

				const buildItems = (): SettingItem[] => {
					const tools: SettingItem[] = allTools.map((tool) => ({
						id: tool.name,
						label: tool.name,
						description: (tool.description ?? "").replace(/\s+/g, " ").slice(0, 160),
						currentValue: enabledTools.has(tool.name) ? "enabled" : "disabled",
						values: ["enabled", "disabled"],
					}));

					const allOn = allTools.length > 0 && allTools.every((t) => enabledTools.has(t.name));
					const enabledCount = allTools.filter((t) => enabledTools.has(t.name)).length;
					tools.unshift({
						id: "__toggle_all__",
						label: "全部启用 / 禁用",
						description: `当前 ${enabledCount}/${allTools.length} 个工具启用`,
						currentValue: allOn ? "全选" : "未全选",
						values: [allOn ? "未全选" : "全选"],
					});
					return tools;
				};

				let items = buildItems();
				lastToolCount = items.length;

				const container = new Container();
				container.addChild(
					new (class {
						render(_width: number) {
							return [theme.fg("accent", theme.bold("工具配置")), ""];
						}
						invalidate() {}
					})(),
				);

				const settingsList = new SettingsList(
					items,
					Math.min(items.length + 2, 15),
					getSettingsListTheme(),
					(id, newValue) => {
						if (id === "__toggle_all__") {
							const allOn = allTools.length > 0 && allTools.every((t) => enabledTools.has(t.name));
							if (allOn) enabledTools.clear();
							else for (const t of allTools) enabledTools.add(t.name);
						} else {
							if (newValue === "enabled") enabledTools.add(id);
							else enabledTools.delete(id);
						}
						applyTools();
						persistState();
						// 同步右侧状态值与计数
						for (const t of allTools) {
							settingsList.updateValue(t.name, enabledTools.has(t.name) ? "enabled" : "disabled");
						}
						const nowAllOn = allTools.length > 0 && allTools.every((t) => enabledTools.has(t.name));
						settingsList.updateValue("__toggle_all__", nowAllOn ? "全选" : "未全选");
					},
					() => {
						done(undefined);
					},
				);

				container.addChild(settingsList);

				const component = {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};

				return component;
			});
		},
	});

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	// Restore state when navigating the session tree
	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});
}
