use super::utility_tools;
use crate::models::ai::*;
use crate::services::file::tools as file_tools;
use crate::services::web::{scraper as web_scraper, search as web_search};
use serde_json::Value;

/// 快捷构造一个 [`ToolDefinition`] 实例。
///
/// 将名称、描述与 JSON Schema 参数封装为符合 OpenAI Function Calling 规范的工具定义，
/// 避免在 [`all_tools`] 中重复书写样板代码。
///
/// # Arguments
///
/// * `name`   - 工具的唯一注册名称，AI 模型调用时以此名称标识。
/// * `desc`   - 对工具功能的自然语言描述，供 AI 模型判断何时调用该工具。
/// * `params` - 工具参数的 JSON Schema 定义（`object` 类型）。
///
/// # Returns
///
/// * [`ToolDefinition`] - 填充好所有字段的工具定义实例。
fn tool(name: &str, desc: &str, params: Value) -> ToolDefinition {
    ToolDefinition {
        tool_type: "function".to_string(),
        function: ToolFunctionDef {
            name: name.to_string(),
            description: desc.to_string(),
            parameters: params,
        },
    }
}

/// 构造单个工具在 MCP `tools/list` 响应中使用的 JSON 对象。
///
/// MCP 协议要求的字段与 AI API 的 `ToolDefinition` 略有不同：
/// 参数 schema 键名为 `inputSchema` 而非 `parameters`。
///
/// # Arguments
///
/// * `name`   - 工具的唯一注册名称。
/// * `desc`   - 工具功能的自然语言描述。
/// * `schema` - 工具参数的 JSON Schema，对应 MCP 规范中的 `inputSchema` 字段。
///
/// # Returns
///
/// * `serde_json::Value` - 符合 MCP `tools/list` 响应格式的工具 JSON 对象。
fn mcp_tool(name: &str, desc: &str, schema: Value) -> Value {
    serde_json::json!({ "name": name, "description": desc, "inputSchema": schema })
}

/// 返回所有已注册工具的基本信息三元组列表。
///
/// 每个元素为 `(名称, 描述, 参数 JSON Schema)`，被 [`build_tool_definitions`] 和
/// [`build_mcp_tool_list`] 共同引用，确保 AI 调用与 MCP 导出的工具集始终一致，
/// 是整个系统工具注册的唯一来源（single source of truth）。
///
/// # Returns
///
/// * `Vec<(&'static str, &'static str, Value)>` - 所有工具的 `(名称, 描述, schema)` 列表。
fn all_tools() -> Vec<(&'static str, &'static str, Value)> {
    vec![
        (
            "browse_website",
            "抓取并解析网页内容，返回标题、正文和链接。",
            serde_json::json!({
                "type": "object",
                "properties": { "url": { "type": "string", "description": "要浏览的网页 URL" } },
                "required": ["url"]
            }),
        ),
        (
            "fetch_url_raw",
            "获取 URL 原始文本内容，适用于 API 或 JSON。",
            serde_json::json!({
                "type": "object",
                "properties": { "url": { "type": "string", "description": "要获取的 URL" } },
                "required": ["url"]
            }),
        ),
        (
            "web_search",
            "搜索互联网，返回相关网页结果列表。当用户询问最新信息、不确定的事实时使用。",
            serde_json::json!({
                "type": "object",
                "properties": { "query": { "type": "string", "description": "搜索关键词" } },
                "required": ["query"]
            }),
        ),
        (
            "extract_webpage_images",
            "提取网页中所有图片 URL 和描述。",
            serde_json::json!({
                "type": "object",
                "properties": { "url": { "type": "string", "description": "网页 URL" } },
                "required": ["url"]
            }),
        ),
        (
            "get_current_datetime",
            "获取当前日期时间、星期和时区信息。",
            serde_json::json!({
                "type": "object",
                "properties": { "timezone": { "type": "string", "description": "时区（可选）" } }
            }),
        ),
        (
            "encode_decode",
            "文本编码/解码，支持 base64、url、hex。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["encode", "decode"] },
                    "encoding": { "type": "string", "enum": ["base64", "url", "hex"] },
                    "text": { "type": "string", "description": "要处理的文本" }
                },
                "required": ["action", "encoding", "text"]
            }),
        ),
        (
            "get_ip_geolocation",
            "查询 IP 地址地理位置（国家、城市、ISP）。",
            serde_json::json!({
                "type": "object",
                "properties": { "ip": { "type": "string", "description": "IP 地址（可选）" } }
            }),
        ),
        (
            "text_stats",
            "统计文本字符数、词数、行数和字节数。",
            serde_json::json!({
                "type": "object",
                "properties": { "text": { "type": "string", "description": "要统计的文本" } },
                "required": ["text"]
            }),
        ),
        (
            "list_directory",
            "列出目录下所有文件和文件夹。",
            serde_json::json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "目录绝对路径" } },
                "required": ["path"]
            }),
        ),
        (
            "read_file",
            "读取文件文本内容。用于查看代码、配置文件。",
            serde_json::json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "文件绝对路径" } },
                "required": ["path"]
            }),
        ),
        (
            "write_file",
            "创建或覆盖写入文件。用于新建脚本、修改代码、修复bug。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "文件绝对路径" },
                    "content": { "type": "string", "description": "文件内容" }
                },
                "required": ["path", "content"]
            }),
        ),
        (
            "create_directory",
            "创建新目录（支持递归）。",
            serde_json::json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "目录绝对路径" } },
                "required": ["path"]
            }),
        ),
        (
            "delete_path",
            "删除文件或目录（目录递归删除），请谨慎使用。",
            serde_json::json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "路径" } },
                "required": ["path"]
            }),
        ),
        (
            "search_files",
            "在目录中按文件名关键词搜索文件。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "directory": { "type": "string", "description": "搜索目录" },
                    "keyword": { "type": "string", "description": "文件名关键词" }
                },
                "required": ["directory", "keyword"]
            }),
        ),
    ]
}

/// 构建供 AI API 使用的工具定义列表。
///
/// 将 [`all_tools`] 返回的三元组转换为符合 OpenAI Function Calling 规范的
/// [`ToolDefinition`] 实例列表，在每轮 AI 流式请求中作为 `tools` 字段传入。
///
/// # Returns
///
/// * `Vec<ToolDefinition>` - 所有已注册工具的完整定义列表。
pub fn build_tool_definitions() -> Vec<ToolDefinition> {
    all_tools()
        .into_iter()
        .map(|(name, desc, params)| tool(name, desc, params))
        .collect()
}

/// 构建 MCP `tools/list` 响应中返回的工具 JSON 数组。
///
/// 与 [`build_tool_definitions`] 使用相同的 [`all_tools`] 数据源，
/// 但输出格式遵循 MCP 规范（`inputSchema` 字段），供 MCP 客户端发现可用工具。
///
/// # Returns
///
/// * `Vec<serde_json::Value>` - 所有已注册工具的 MCP 格式 JSON 对象列表。
pub fn build_mcp_tool_list() -> Vec<Value> {
    all_tools()
        .into_iter()
        .map(|(name, desc, schema)| mcp_tool(name, desc, schema))
        .collect()
}

/// 按工具名称调度并执行对应的工具函数，返回结果字符串。
///
/// 作为 AI 调用与 MCP 调用的统一入口，保证两条调用路径使用相同的执行逻辑。
/// 参数解析通过 [`dispatch`] 辅助函数完成，解析失败时返回包含错误信息的字符串，
/// 确保调用链不中断，AI 模型可据此判断如何处理错误。
///
/// # Arguments
///
/// * `name` - 工具的注册名称，需与 [`all_tools`] 中的名称完全一致。
/// * `args` - 工具调用参数，来源于 AI 模型生成的 JSON 对象或 MCP 请求的 `arguments` 字段。
///
/// # Returns
///
/// * `String` - 工具执行的结果文本；工具名称未知时返回 `"未知工具: <name>"`。
pub async fn execute_tool(name: &str, args: Value) -> String {
    match name {
        "browse_website" => {
            dispatch::<BrowseArgs, _>(args, |a| async move {
                web_scraper::browse_website(&a.url).await
            })
            .await
        }
        "fetch_url_raw" => {
            dispatch::<FetchRawArgs, _>(args, |a| async move {
                web_scraper::fetch_url_raw(&a.url).await
            })
            .await
        }
        "web_search" => {
            dispatch::<SearchArgs, _>(
                args,
                |a| async move { web_search::web_search(&a.query).await },
            )
            .await
        }
        "extract_webpage_images" => {
            dispatch::<ExtractImagesArgs, _>(args, |a| async move {
                web_search::extract_webpage_images(&a.url).await
            })
            .await
        }
        "get_current_datetime" => match serde_json::from_value::<DatetimeArgs>(args) {
            Ok(a) => utility_tools::get_current_datetime(a.timezone.as_deref()),
            Err(e) => format!("参数解析失败: {}", e),
        },
        "encode_decode" => match serde_json::from_value::<EncodeDecodeArgs>(args) {
            Ok(a) => utility_tools::encode_decode(&a.action, &a.encoding, &a.text),
            Err(e) => format!("参数解析失败: {}", e),
        },
        "get_ip_geolocation" => {
            dispatch::<IpGeoArgs, _>(args, |a| async move {
                utility_tools::get_ip_geolocation(a.ip.as_deref()).await
            })
            .await
        }
        "text_stats" => match serde_json::from_value::<TextStatsArgs>(args) {
            Ok(a) => utility_tools::text_stats(&a.text),
            Err(e) => format!("参数解析失败: {}", e),
        },
        "list_directory" => match serde_json::from_value::<ListDirArgs>(args) {
            Ok(a) => file_tools::list_directory(&a.path),
            Err(e) => format!("参数解析失败: {}", e),
        },
        "read_file" => match serde_json::from_value::<ReadFileArgs>(args) {
            Ok(a) => file_tools::read_file(&a.path),
            Err(e) => format!("参数解析失败: {}", e),
        },
        "write_file" => match serde_json::from_value::<WriteFileArgs>(args) {
            Ok(a) => file_tools::write_file(&a.path, &a.content),
            Err(e) => format!("参数解析失败: {}", e),
        },
        "create_directory" => match serde_json::from_value::<CreateDirArgs>(args) {
            Ok(a) => file_tools::create_directory(&a.path),
            Err(e) => format!("参数解析失败: {}", e),
        },
        "delete_path" => match serde_json::from_value::<DeletePathArgs>(args) {
            Ok(a) => file_tools::delete_path(&a.path),
            Err(e) => format!("参数解析失败: {}", e),
        },
        "search_files" => match serde_json::from_value::<SearchFilesArgs>(args) {
            Ok(a) => file_tools::search_files(&a.directory, &a.keyword),
            Err(e) => format!("参数解析失败: {}", e),
        },
        other => format!("未知工具: {}", other),
    }
}

/// 通用异步工具调度辅助函数：反序列化参数后调用工具执行闭包。
///
/// 将参数反序列化与工具调用解耦，统一处理解析失败的情况，
/// 避免在 [`execute_tool`] 的每个分支中重复书写 `serde_json::from_value` + 错误处理。
///
/// # Type Parameters
///
/// * `A` - 工具参数结构体类型，需实现 [`serde::de::DeserializeOwned`]。
/// * `F` - 返回 `Future<Output = String>` 的异步闭包类型。
///
/// # Arguments
///
/// * `args` - 需要反序列化为 `A` 的 JSON `Value`。
/// * `f`    - 接收反序列化后的参数 `A`，返回工具执行结果字符串的异步闭包。
///
/// # Returns
///
/// * 参数解析成功时，返回闭包 `f` 的执行结果。
/// * 参数解析失败时，返回 `"参数解析失败: <错误信息>"` 字符串。
async fn dispatch<A, F>(args: Value, f: impl FnOnce(A) -> F) -> String
where
    A: serde::de::DeserializeOwned,
    F: std::future::Future<Output = String>,
{
    match serde_json::from_value::<A>(args) {
        Ok(a) => f(a).await,
        Err(e) => format!("参数解析失败: {}", e),
    }
}
