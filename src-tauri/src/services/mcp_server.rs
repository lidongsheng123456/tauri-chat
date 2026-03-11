use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::broadcast;
use warp::Filter;

use crate::services::ai::tool_registry;

/// MCP 服务名称，在 `initialize` 响应的 `serverInfo` 字段中返回给客户端。
const MCP_SERVER_NAME: &str = "lanchat-mcp";

/// MCP 服务版本号，随 `serverInfo` 一同返回。
const MCP_SERVER_VERSION: &str = "1.0.0";

/// MCP 协议版本，告知客户端本服务实现所遵循的协议规范日期。
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// JSON-RPC 2.0 请求体，对应 MCP 客户端向服务端发送的每一条消息。
///
/// 遵循 JSON-RPC 2.0 规范：`jsonrpc` 字段固定为 `"2.0"`，
/// `id` 为可选的请求标识符（通知消息时为 `null`），
/// `params` 由各 `method` 自定义结构。
#[derive(Serialize, Deserialize, Debug)]
pub struct JsonRpcRequest {
    /// JSON-RPC 协议版本，固定为 `"2.0"`。
    pub jsonrpc: String,
    /// 请求标识符，响应时原样返回；通知消息（不需要响应）时为 `None`。
    pub id: Option<Value>,
    /// 调用的方法名称，例如 `"initialize"`、`"tools/list"`、`"tools/call"`。
    pub method: String,
    /// 方法调用的参数，结构由各 `method` 自定义；不传参数时为 `None`。
    #[serde(default)]
    pub params: Option<Value>,
}

/// JSON-RPC 2.0 响应体，由服务端处理请求后返回给客户端。
///
/// `result` 与 `error` 互斥：成功时仅序列化 `result`，失败时仅序列化 `error`。
/// 两者均被标注为 `skip_serializing_if = "Option::is_none"` 以符合规范。
#[derive(Serialize, Debug)]
pub struct JsonRpcResponse {
    /// JSON-RPC 协议版本，固定为 `"2.0"`。
    pub jsonrpc: String,
    /// 对应请求的 `id`，通知响应时为 `None`，序列化时跳过。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    /// 请求成功时的返回值，失败时为 `None`，序列化时跳过。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// 请求失败时的错误对象，成功时为 `None`，序列化时跳过。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

/// JSON-RPC 2.0 错误对象，携带标准化错误码与可读描述信息。
#[derive(Serialize, Debug)]
pub struct JsonRpcError {
    /// JSON-RPC 2.0 规范定义的错误码，例如 `-32601`（方法未找到）。
    pub code: i32,
    /// 人类可读的错误描述信息。
    pub message: String,
    /// 附加的错误详情数据，大多数情况下为 `None`，序列化时跳过。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl JsonRpcResponse {
    /// 构造一条 JSON-RPC 2.0 成功响应。
    ///
    /// # Arguments
    ///
    /// * `id`     - 对应请求的标识符，原样返回给客户端。
    /// * `result` - 请求的执行结果，序列化为 JSON `Value`。
    ///
    /// # Returns
    ///
    /// * [`JsonRpcResponse`] - 填充好 `result` 字段、`error` 为 `None` 的响应实例。
    fn success(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    /// 构造一条 JSON-RPC 2.0 错误响应。
    ///
    /// # Arguments
    ///
    /// * `id`      - 对应请求的标识符，原样返回给客户端；通知消息时为 `None`。
    /// * `code`    - JSON-RPC 2.0 规范定义的错误码。
    /// * `message` - 人类可读的错误描述字符串。
    ///
    /// # Returns
    ///
    /// * [`JsonRpcResponse`] - 填充好 `error` 字段、`result` 为 `None` 的响应实例。
    fn error(id: Option<Value>, code: i32, message: &str) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.to_string(),
                data: None,
            }),
        }
    }
}

/// 处理单条 MCP JSON-RPC 请求，根据 `method` 字段路由至对应逻辑。
///
/// 支持以下 MCP 方法：
/// - `initialize`              — 握手，返回协议版本与服务能力声明。
/// - `notifications/initialized` — 客户端确认初始化完成的通知，返回空对象。
/// - `tools/list`              — 返回所有可调用工具的名称、描述与参数 schema 列表。
/// - `tools/call`              — 按名称执行指定工具，将结果以 MCP 内容格式返回。
/// - 其他方法                  — 返回 `-32601 Method not found` 错误。
///
/// # Arguments
///
/// * `req`     - 已反序列化的 JSON-RPC 2.0 请求对象。
/// * `_sse_tx` - SSE 广播发送端（当前保留，供未来推送通知使用，暂未使用）。
///
/// # Returns
///
/// * [`JsonRpcResponse`] - 处理结果的 JSON-RPC 2.0 响应对象。
async fn handle_rpc(req: JsonRpcRequest, _sse_tx: broadcast::Sender<String>) -> JsonRpcResponse {
    match req.method.as_str() {
        "initialize" => JsonRpcResponse::success(
            req.id,
            serde_json::json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": MCP_SERVER_NAME, "version": MCP_SERVER_VERSION }
            }),
        ),

        "notifications/initialized" => JsonRpcResponse::success(req.id, serde_json::json!({})),

        "tools/list" => JsonRpcResponse::success(
            req.id,
            serde_json::json!({
                "tools": tool_registry::build_mcp_tool_list()
            }),
        ),

        "tools/call" => {
            let params = req.params.unwrap_or(Value::Null);
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or(Value::Object(serde_json::Map::new()));

            let result_text = tool_registry::execute_tool(tool_name, arguments).await;
            // 使用 starts_with 精确匹配工具层返回的错误前缀，避免 contains("失败") 将
            // 读取到的文件内容（如错误日志）或网页内容误判为工具执行失败。
            let is_error = result_text.starts_with("未知工具")
                || result_text.starts_with("操作失败")
                || result_text.starts_with("参数解析失败")
                || result_text.starts_with("抓取网页失败")
                || result_text.starts_with("获取 URL 内容失败")
                || result_text.starts_with("搜索失败")
                || result_text.starts_with("获取网页失败")
                || result_text.starts_with("IP 查询失败")
                || result_text.starts_with("IP 查询结果解析失败")
                || result_text.starts_with("不支持的操作")
                || result_text.starts_with("搜索结果解析失败")
                || result_text.starts_with("选择器解析失败");

            JsonRpcResponse::success(
                req.id,
                serde_json::json!({
                    "content": [{ "type": "text", "text": result_text }],
                    "isError": is_error
                }),
            )
        }

        _ => JsonRpcResponse::error(req.id, -32601, &format!("Method not found: {}", req.method)),
    }
}

/// 启动 MCP（Model Context Protocol）服务，在指定端口提供 JSON-RPC 与 SSE 两条路由。
///
/// 路由说明：
/// - `POST /mcp`     — JSON-RPC 2.0 端点，接收客户端请求并返回同步响应。
/// - `GET  /mcp/sse` — Server-Sent Events 端点，供客户端订阅服务端主动推送的通知（保留接口）。
///
/// 本服务与 AI 工具注册表（[`tool_registry`]）共享工具列表，
/// 支持外部 MCP 客户端（如 Claude Desktop）直接调用 LanChat 的内置工具能力。
///
/// 若端口绑定失败，记录错误日志后直接返回（不 panic，不影响主应用进程）。
///
/// # Arguments
///
/// * `port` - MCP 服务监听端口，来源于 `lanchat.config.json` 的 `server.mcp_port`。
///
/// # Returns
///
/// 此函数在正常情况下不会返回（持续运行直至进程退出）。
pub async fn start_mcp_server(port: u16) {
    let (sse_tx, _) = broadcast::channel::<String>(100);

    let sse_tx_filter = {
        let tx = sse_tx.clone();
        warp::any().map(move || tx.clone())
    };

    let rpc_route = warp::path("mcp")
        .and(warp::post())
        .and(warp::body::json::<JsonRpcRequest>())
        .and(sse_tx_filter.clone())
        .and_then(
            |req: JsonRpcRequest, sse_tx: broadcast::Sender<String>| async move {
                let response = handle_rpc(req, sse_tx).await;
                Ok::<_, warp::Rejection>(warp::reply::json(&response))
            },
        );

    let sse_route = warp::path("mcp")
        .and(warp::path("sse"))
        .and(warp::get())
        .and(sse_tx_filter)
        .map(|sse_tx: broadcast::Sender<String>| {
            let rx = sse_tx.subscribe();
            let stream =
                tokio_stream::wrappers::BroadcastStream::new(rx).filter_map(|result| async {
                    match result {
                        Ok(data) => {
                            Some(Ok::<_, warp::Error>(warp::sse::Event::default().data(data)))
                        }
                        Err(_) => None,
                    }
                });
            warp::sse::reply(stream)
        });

    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec!["content-type"])
        .allow_methods(vec!["GET", "POST", "OPTIONS"]);

    let routes = rpc_route.or(sse_route).with(cors);
    log::info!("MCP server starting on port {}", port);

    let addr: std::net::SocketAddr = ([0, 0, 0, 0], port).into();
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
            warp::serve(routes).run_incoming(incoming).await;
        }
        Err(e) => log::error!("Failed to bind MCP server to port {}: {}", port, e),
    }
}
