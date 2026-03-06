use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::broadcast;
use warp::Filter;

use crate::models::ai::*;
use crate::services::{tools_service, web_scraper, web_search};

/// MCP 服务名称
const MCP_SERVER_NAME: &str = "lanchat-mcp";
/// MCP 服务版本
const MCP_SERVER_VERSION: &str = "1.0.0";
/// MCP 协议版本
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// JSON-RPC 2.0 请求体
#[derive(Serialize, Deserialize, Debug)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

/// JSON-RPC 2.0 响应体
#[derive(Serialize, Debug)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

/// JSON-RPC 错误对象
#[derive(Serialize, Debug)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl JsonRpcResponse {
    /// 构造成功响应
    fn success(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    /// 构造错误响应
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

/// 处理 MCP JSON-RPC 请求（initialize、tools/list、tools/call 等）
async fn handle_rpc(req: JsonRpcRequest, _sse_tx: broadcast::Sender<String>) -> JsonRpcResponse {
    match req.method.as_str() {
        "initialize" => JsonRpcResponse::success(
            req.id,
            serde_json::json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {
                    "tools": { "listChanged": false }
                },
                "serverInfo": {
                    "name": MCP_SERVER_NAME,
                    "version": MCP_SERVER_VERSION
                }
            }),
        ),

        "notifications/initialized" => JsonRpcResponse::success(req.id, serde_json::json!({})),

        "tools/list" => {
            let t = |name: &str, desc: &str, schema: Value| -> Value {
                serde_json::json!({ "name": name, "description": desc, "inputSchema": schema })
            };
            JsonRpcResponse::success(
                req.id,
                serde_json::json!({
                    "tools": [
                        t("browse_website", "抓取并解析网页内容，返回标题、正文和链接。", serde_json::json!({
                            "type": "object",
                            "properties": { "url": { "type": "string", "description": "要浏览的网页 URL" } },
                            "required": ["url"]
                        })),
                        t("fetch_url_raw", "获取 URL 原始文本内容，适用于 API 或 JSON。", serde_json::json!({
                            "type": "object",
                            "properties": { "url": { "type": "string", "description": "要获取的 URL" } },
                            "required": ["url"]
                        })),
                        t("web_search", "搜索互联网，返回相关网页结果列表。", serde_json::json!({
                            "type": "object",
                            "properties": { "query": { "type": "string", "description": "搜索关键词" } },
                            "required": ["query"]
                        })),
                        t("extract_webpage_images", "提取网页中所有图片 URL 和描述。", serde_json::json!({
                            "type": "object",
                            "properties": { "url": { "type": "string", "description": "网页 URL" } },
                            "required": ["url"]
                        })),
                        t("get_current_datetime", "获取当前日期时间、星期和时区信息。", serde_json::json!({
                            "type": "object",
                            "properties": { "timezone": { "type": "string", "description": "时区（可选）" } }
                        })),
                        t("encode_decode", "文本编码/解码，支持 base64、url、hex。", serde_json::json!({
                            "type": "object",
                            "properties": {
                                "action": { "type": "string", "enum": ["encode", "decode"] },
                                "encoding": { "type": "string", "enum": ["base64", "url", "hex"] },
                                "text": { "type": "string", "description": "要处理的文本" }
                            },
                            "required": ["action", "encoding", "text"]
                        })),
                        t("get_ip_geolocation", "查询 IP 地址地理位置（国家、城市、ISP）。", serde_json::json!({
                            "type": "object",
                            "properties": { "ip": { "type": "string", "description": "IP 地址（可选）" } }
                        })),
                        t("text_stats", "统计文本字符数、词数、行数和字节数。", serde_json::json!({
                            "type": "object",
                            "properties": { "text": { "type": "string", "description": "要统计的文本" } },
                            "required": ["text"]
                        })),
                    ]
                }),
            )
        }

        "tools/call" => {
            let params = req.params.unwrap_or(Value::Null);
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or(Value::Object(serde_json::Map::new()));

            let result_text = match tool_name {
                "browse_website" => match serde_json::from_value::<BrowseArgs>(arguments) {
                    Ok(a) => web_scraper::browse_website(&a.url).await,
                    Err(e) => format!("参数解析失败: {}", e),
                },
                "fetch_url_raw" => match serde_json::from_value::<FetchRawArgs>(arguments) {
                    Ok(a) => web_scraper::fetch_url_raw(&a.url).await,
                    Err(e) => format!("参数解析失败: {}", e),
                },
                "web_search" => match serde_json::from_value::<SearchArgs>(arguments) {
                    Ok(a) => web_search::web_search(&a.query).await,
                    Err(e) => format!("参数解析失败: {}", e),
                },
                "extract_webpage_images" => {
                    match serde_json::from_value::<ExtractImagesArgs>(arguments) {
                        Ok(a) => web_search::extract_webpage_images(&a.url).await,
                        Err(e) => format!("参数解析失败: {}", e),
                    }
                }
                "get_current_datetime" => match serde_json::from_value::<DatetimeArgs>(arguments) {
                    Ok(a) => tools_service::get_current_datetime(a.timezone.as_deref()),
                    Err(e) => format!("参数解析失败: {}", e),
                },
                "encode_decode" => match serde_json::from_value::<EncodeDecodeArgs>(arguments) {
                    Ok(a) => tools_service::encode_decode(&a.action, &a.encoding, &a.text),
                    Err(e) => format!("参数解析失败: {}", e),
                },
                "get_ip_geolocation" => match serde_json::from_value::<IpGeoArgs>(arguments) {
                    Ok(a) => tools_service::get_ip_geolocation(a.ip.as_deref()).await,
                    Err(e) => format!("参数解析失败: {}", e),
                },
                "text_stats" => match serde_json::from_value::<TextStatsArgs>(arguments) {
                    Ok(a) => tools_service::text_stats(&a.text),
                    Err(e) => format!("参数解析失败: {}", e),
                },
                _ => format!("未知工具: {}", tool_name),
            };

            let is_error = result_text.contains("失败") || result_text.starts_with("未知工具");

            JsonRpcResponse::success(
                req.id,
                serde_json::json!({
                    "content": [{
                        "type": "text",
                        "text": result_text
                    }],
                    "isError": is_error
                }),
            )
        }

        _ => JsonRpcResponse::error(req.id, -32601, &format!("Method not found: {}", req.method)),
    }
}

/// 启动 MCP 服务，监听指定端口，提供 RPC 和 SSE 路由
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
        Err(e) => {
            log::error!("Failed to bind MCP server to port {}: {}", port, e);
        }
    }
}
