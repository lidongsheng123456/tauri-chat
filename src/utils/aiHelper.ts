/**
 * aiHelper.ts — AI 工具辅助函数
 *
 * 纯函数，无副作用，无 React 依赖，可在项目任意位置安全引用。
 * 统一收录与 AI 工具调用相关的数据解析与状态推断逻辑。
 */

import type { AiToolRoundTrace } from "../hooks/useAiChat";

// ─── 工具状态推断 ─────────────────────────────────────────────────────────────

/**
 * 根据用户消息内容推测最可能触发的工具，返回对应的加载状态提示文本。
 *
 * 使用正则匹配关键词，优先级从上到下递减。
 * 无法匹配时返回 null（不显示状态提示）。
 *
 * @param content - 用户输入的原始消息文本
 * @returns 状态提示字符串，或 null
 */
export function detectToolHint(content: string): string | null {
    const lower = content.toLowerCase();

    if (/https?:\/\/[^\s]+/.test(content)) return "正在浏览网页并抓取内容...";
    if (/搜索|搜一下|查一下|search|google/i.test(lower))
        return "正在搜索互联网...";
    if (/几点|时间|日期|今天|星期|what time|today/i.test(lower))
        return "正在获取当前时间...";
    if (/编码|解码|base64|encode|decode|hex/i.test(lower))
        return "正在编码/解码...";
    if (/ip.*位置|ip.*地址|geolocation|ip.*查询/i.test(lower))
        return "正在查询 IP 信息...";
    if (
        /图片|提取.*图|images|extract.*img/i.test(lower) &&
        /https?:\/\//.test(content)
    ) {
        return "正在提取网页图片...";
    }
    if (/读取文件|查看文件|read.*file|打开.*文件|看一下.*代码/i.test(lower))
        return "正在读取文件...";
    if (
        /写入文件|创建文件|新建.*文件|write.*file|生成.*脚本|修改.*文件|修.*bug/i.test(
            lower,
        )
    ) {
        return "正在操作文件...";
    }
    if (/列出.*目录|目录.*结构|文件夹.*内容|list.*dir|ls /i.test(lower))
        return "正在浏览目录...";
    if (/搜索文件|查找文件|search.*file|找.*文件/i.test(lower))
        return "正在搜索文件...";
    if (/删除文件|删除目录|delete.*file|remove/i.test(lower))
        return "正在删除...";
    if (/创建目录|新建文件夹|mkdir|create.*dir/i.test(lower))
        return "正在创建目录...";

    return null;
}

// ─── 工具结果解析 ─────────────────────────────────────────────────────────────

/** 单条引用来源 */
export interface SourceItem {
    key: string;
    title: string;
    url?: string;
}

/** 单条文件卡片 */
export interface FileCardItem {
    name: string;
    path: string;
    tool: string;
}

/** 直接以 url 参数作为来源的工具集合 */
const URL_TOOLS = new Set([
    "browse_website",
    "fetch_url_raw",
    "extract_webpage_images",
]);

/** 涉及文件路径操作的工具集合 */
const FILE_TOOLS = new Set([
    "read_file",
    "write_file",
    "create_directory",
    "delete_path",
    "list_directory",
]);

/**
 * 从工具调用轮次中解析引用来源列表，用于在 AI 回复下方展示"引用 N 个来源"。
 *
 * 处理以下工具：
 *   - browse_website / fetch_url_raw / extract_webpage_images：直接取 url 参数
 *   - web_search：解析结果文本中 "### N. 标题" 与 "链接: https://..." 格式
 *
 * @param toolRounds - AI 工具调用轮次列表
 * @returns 去重后的来源数组
 */
export function extractSources(toolRounds: AiToolRoundTrace[]): SourceItem[] {
    const sources: SourceItem[] = [];
    const seen = new Set<string>();

    for (const round of toolRounds) {
        for (const tool of round.tool_calls) {
            // 直接 url 参数工具
            if (URL_TOOLS.has(tool.tool_name)) {
                const args = tool.arguments as Record<string, string> | null;
                const url = args?.url;
                if (url && !seen.has(url)) {
                    seen.add(url);
                    sources.push({ key: url, title: url, url });
                }
            }

            // 解析 web_search 返回文本中的标题与链接
            if (
                tool.tool_name === "web_search" &&
                typeof tool.result === "string"
            ) {
                const titleRe = /^###\s+\d+\.\s+(.+)$/gm;
                const linkRe = /^链接:\s*(https?:\/\/\S+)$/gm;
                const titles: string[] = [];
                const links: string[] = [];
                let m: RegExpExecArray | null;
                while ((m = titleRe.exec(tool.result)) !== null)
                    titles.push(m[1].trim());
                while ((m = linkRe.exec(tool.result)) !== null)
                    links.push(m[1].trim());
                links.forEach((url, i) => {
                    if (!seen.has(url)) {
                        seen.add(url);
                        sources.push({
                            key: url,
                            title: titles[i] ?? url,
                            url,
                        });
                    }
                });
            }
        }
    }

    return sources;
}

/**
 * 从工具调用轮次中解析文件卡片列表，用于在 AI 回复下方展示操作过的文件。
 *
 * 覆盖工具：read_file / write_file / create_directory / delete_path / list_directory
 *
 * @param toolRounds - AI 工具调用轮次列表
 * @returns 去重后的文件卡片数组
 */
export function extractFileCards(toolRounds: AiToolRoundTrace[]): FileCardItem[] {
    const files: FileCardItem[] = [];
    const seen = new Set<string>();

    for (const round of toolRounds) {
        for (const tool of round.tool_calls) {
            if (FILE_TOOLS.has(tool.tool_name)) {
                const args = tool.arguments as Record<string, string> | null;
                const path = args?.path ?? args?.directory ?? "";
                if (path && !seen.has(path)) {
                    seen.add(path);
                    // 取路径最后一段作为显示文件名
                    const name =
                        path.replace(/\\/g, "/").split("/").pop() ?? path;
                    files.push({ name, path, tool: tool.tool_name });
                }
            }
        }
    }

    return files;
}
