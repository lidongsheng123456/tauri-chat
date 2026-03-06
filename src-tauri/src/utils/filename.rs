/// 将文件名中的非法字符替换为下划线，限制长度 100
pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .take(100)
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
