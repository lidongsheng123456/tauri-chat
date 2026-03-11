use crate::services::web::scraper as web_scraper;

/// 获取当前本地日期、时间、星期与时区信息，格式化为多行结构化文本。
///
/// 使用系统本地时间（[`chrono::Local::now`]），将英文星期名转换为中文，
/// 并同时输出 ISO 8601 格式与 Unix 时间戳，方便 AI 模型直接引用。
///
/// # Arguments
///
/// * `timezone` - 可选的时区标识字符串（仅用于展示，不影响实际计算）；
///   为 `None` 或空字符串时显示为 `"system"`。
///
/// # Returns
///
/// * `String` - 包含日期、时间、星期、时区、ISO 8601 与 Unix 时间戳的多行格式化字符串。
pub fn get_current_datetime(timezone: Option<&str>) -> String {
    let now = chrono::Local::now();

    let tz_label = timezone.unwrap_or("system");
    let weekday_cn = match now.format("%A").to_string().as_str() {
        "Monday" => "星期一",
        "Tuesday" => "星期二",
        "Wednesday" => "星期三",
        "Thursday" => "星期四",
        "Friday" => "星期五",
        "Saturday" => "星期六",
        "Sunday" => "星期日",
        _ => "未知",
    };

    format!(
        "当前时间信息：\n\
         - 日期: {}\n\
         - 时间: {}\n\
         - 星期: {}\n\
         - 时区: {} ({})\n\
         - ISO 8601: {}\n\
         - Unix 时间戳: {}",
        now.format("%Y-%m-%d"),
        now.format("%H:%M:%S"),
        weekday_cn,
        now.format("%:z"),
        tz_label,
        now.format("%Y-%m-%dT%H:%M:%S%:z"),
        now.timestamp(),
    )
}

/// 对文本执行编码或解码操作，支持 Base64、URL 编码与十六进制三种格式。
///
/// `action` 与 `encoding` 的组合决定具体行为：
/// - `("encode", "base64")` — 将 UTF-8 字符串编码为标准 Base64。
/// - `("decode", "base64")` — 将 Base64 字符串解码为 UTF-8 文本。
/// - `("encode", "url")`    — 对字符串进行百分号 URL 编码。
/// - `("decode", "url")`    — 对百分号编码字符串进行解码。
/// - `("encode", "hex")`    — 将 UTF-8 字节序列转换为十六进制字符串（小写）。
/// - `("decode", "hex")`    — 将十六进制字符串解码为 UTF-8 文本（自动忽略空白字符）。
///
/// # Arguments
///
/// * `action`   - 操作类型，取值为 `"encode"` 或 `"decode"`。
/// * `encoding` - 编码格式，取值为 `"base64"`、`"url"` 或 `"hex"`。
/// * `text`     - 待处理的原始文本内容。
///
/// # Returns
///
/// * 操作成功时，返回编码或解码后的结果字符串。
/// * 操作失败时（如 Base64/Hex 解码遇到非法字符），返回包含错误原因的中文提示字符串。
/// * 传入不支持的 `action` 或 `encoding` 组合时，返回 `"不支持的操作: ..."` 提示。
pub fn encode_decode(action: &str, encoding: &str, text: &str) -> String {
    match (action, encoding) {
        ("encode", "base64") => {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
        }
        ("decode", "base64") => {
            use base64::Engine;
            match base64::engine::general_purpose::STANDARD.decode(text) {
                Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                Err(e) => format!("Base64 解码失败: {}", e),
            }
        }
        ("encode", "url") => urlencoding::encode(text).to_string(),
        ("decode", "url") => urlencoding::decode(text)
            .map(|s| s.into_owned())
            .unwrap_or_else(|e| format!("URL 解码失败: {}", e)),
        ("encode", "hex") => text
            .as_bytes()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect(),
        ("decode", "hex") => {
            let cleaned: String = text.chars().filter(|c| !c.is_whitespace()).collect();
            if cleaned.len() % 2 != 0 {
                return format!(
                    "Hex 解码失败: 输入长度必须为偶数（当前 {} 个字符）",
                    cleaned.len()
                );
            }
            let bytes: Result<Vec<u8>, _> = (0..cleaned.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&cleaned[i..i + 2], 16))
                .collect();
            match bytes {
                Ok(b) => String::from_utf8_lossy(&b).to_string(),
                Err(e) => format!("Hex 解码失败: {}", e),
            }
        }
        _ => format!("不支持的操作: action={}, encoding={}", action, encoding),
    }
}

/// 通过 `ip-api.com` 免费接口查询 IP 地址的地理位置信息。
///
/// 若 `ip` 为 `None` 或空字符串，则查询当前出口公网 IP 的归属地。
/// 内部复用 [`web_scraper::fetch_url_raw`] 发起 HTTP GET 请求，
/// 成功时解析 JSON 响应并格式化为多行可读文本；
/// 失败时（API 返回 `status: "fail"` 或网络错误）返回中文错误提示。
///
/// # Arguments
///
/// * `ip` - 可选的待查询 IP 地址字符串；为 `None` 或空字符串时查询本机出口 IP。
///
/// # Returns
///
/// * `String` - 包含国家、地区、城市、ISP、经纬度与时区的多行格式化字符串；
///   查询失败时返回包含错误原因的中文提示字符串。
pub async fn get_ip_geolocation(ip: Option<&str>) -> String {
    let url = match ip {
        Some(addr) if !addr.is_empty() => format!("http://ip-api.com/json/{}?lang=zh-CN", addr),
        _ => "http://ip-api.com/json/?lang=zh-CN".to_string(),
    };

    match web_scraper::fetch_url_raw(&url).await {
        result if result.starts_with("获取 URL 内容失败") || result.starts_with("不允许") =>
        {
            format!("IP 查询失败: {}", result)
        }
        json_str => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if v.get("status").and_then(|s| s.as_str()) == Some("success") {
                    format!(
                        "IP 地理位置信息：\n\
                         - IP: {}\n\
                         - 国家: {}\n\
                         - 地区: {}\n\
                         - 城市: {}\n\
                         - ISP: {}\n\
                         - 经纬度: {}, {}\n\
                         - 时区: {}",
                        v["query"].as_str().unwrap_or("-"),
                        v["country"].as_str().unwrap_or("-"),
                        v["regionName"].as_str().unwrap_or("-"),
                        v["city"].as_str().unwrap_or("-"),
                        v["isp"].as_str().unwrap_or("-"),
                        v["lat"].as_f64().unwrap_or(0.0),
                        v["lon"].as_f64().unwrap_or(0.0),
                        v["timezone"].as_str().unwrap_or("-"),
                    )
                } else {
                    format!(
                        "IP 查询失败: {}",
                        v["message"].as_str().unwrap_or("未知错误")
                    )
                }
            } else {
                format!("IP 查询结果解析失败: {}", json_str)
            }
        }
    }
}

/// 对文本内容进行摘要统计，输出字符数、词数、行数与字节数等指标。
///
/// 统计维度说明：
/// - **总字符数**    — 按 Unicode 码位计数（`str::chars().count()`）。
/// - **非空白字符**  — 过滤 `char::is_whitespace()` 后的字符数。
/// - **中文字符数**  — 统计 CJK 统一汉字区间 `\u{4e00}`–`\u{9fff}` 内的字符数。
/// - **英文单词数**  — 按空白分隔（`split_whitespace`）统计词元数量。
/// - **行数**        — 按 `\n` 分行统计（`str::lines().count()`）。
/// - **字节数**      — UTF-8 编码后的原始字节长度（`str::len()`）。
///
/// # Arguments
///
/// * `text` - 需要进行统计分析的文本内容。
///
/// # Returns
///
/// * `String` - 包含各项统计指标的多行格式化字符串。
pub fn text_stats(text: &str) -> String {
    let chars = text.chars().count();
    let chars_no_space = text.chars().filter(|c| !c.is_whitespace()).count();
    let lines = text.lines().count();
    let words_en = text.split_whitespace().count();
    let chinese_chars = text
        .chars()
        .filter(|c| *c >= '\u{4e00}' && *c <= '\u{9fff}')
        .count();
    let bytes = text.len();

    format!(
        "文本统计：\n\
         - 总字符数: {}\n\
         - 非空白字符: {}\n\
         - 中文字符数: {}\n\
         - 英文单词数: {}\n\
         - 行数: {}\n\
         - 字节数: {} ({:.1} KB)",
        chars,
        chars_no_space,
        chinese_chars,
        words_en,
        lines,
        bytes,
        bytes as f64 / 1024.0,
    )
}
