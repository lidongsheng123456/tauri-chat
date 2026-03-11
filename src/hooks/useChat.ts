import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { getConfig } from "../config";
import type { ChatMessage, UserInfo, WsEvent, WsSendEvent } from "../types";
import {
    getStableClientId,
    loadMessages,
    saveMessages,
} from "../utils/storage";

/**
 * `useChat` Hook 的配置项。
 */
interface UseChatOptions {
    /** 聊天服务器地址（含端口），格式为 `host:port`，例如 `"192.168.1.1:9120"`。未登录时传入空字符串以禁止连接。 */
    serverUrl: string;
    /** 当前用户的昵称，加入房间时发送给服务端。未登录时传入空字符串。 */
    nickname: string;
}

/**
 * 局域网聊天核心 Hook，负责管理 WebSocket 连接、消息收发与文件上传。
 *
 * 内部实现要点：
 * - 使用指数退避策略自动重连（初始延迟由 `base_reconnect_delay_ms` 控制，上限为 `max_reconnect_delay_ms`）。
 * - 通过 `useRef` 保存最新动态值（`myUserId`、`nickname`、`serverUrl`），
 *   确保 WebSocket 异步回调中读到的始终是最新值，避免过时闭包。
 * - 服务端历史消息与本地 `localStorage` 缓存通过去重合并策略同步，
 *   防止切换服务器时出现消息串混的问题。
 *
 * @param {UseChatOptions} options - Hook 配置项，包含服务器地址与用户昵称。
 * @returns 包含连接状态、用户列表、消息列表及发送/上传方法的对象。
 */
export function useChat({ serverUrl, nickname }: UseChatOptions) {
    const [connected, setConnected] = useState(false);
    const [myUserId, setMyUserId] = useState("");
    const [users, setUsers] = useState<UserInfo[]>([]);
    // 初始化时从 localStorage 加载当前服务器的本地消息历史
    const [messages, setMessages] = useState<ChatMessage[]>(() =>
        loadMessages(serverUrl),
    );

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttempts = useRef(0);
    const isConnecting = useRef(false);

    // 使用 ref 保存最新值，避免 WebSocket 回调中出现过时闭包
    const myUserIdRef = useRef(myUserId);
    const nicknameRef = useRef(nickname);
    const serverUrlRef = useRef(serverUrl);

    // 在浏览器绘制前同步更新 ref，确保 WebSocket 异步回调中读到的始终是最新值
    useLayoutEffect(() => {
        myUserIdRef.current = myUserId;
        nicknameRef.current = nickname;
        serverUrlRef.current = serverUrl;
    });

    /**
     * 用 ref 持有 connect 函数的最新引用。
     * 这样 onclose 回调可以安全地调用 connectRef.current()，
     * 而无需将 connect 自身放入其 useCallback 依赖数组，
     * 从而避免 const 变量的时间死区（TDZ）问题。
     */
    const connectRef = useRef<() => void>(() => {});

    /**
     * 清除当前待执行的重连定时器。
     *
     * 在建立新连接前调用，防止旧定时器触发后启动多余的连接请求。
     */
    const clearReconnectTimer = useCallback(() => {
        if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
            reconnectTimer.current = null;
        }
    }, []);

    // ── 切换服务器时重置消息 ────────────────────────────────────────────────
    // Bug 修复：useState 初始化器只在首次挂载时执行一次。
    // 若用户登出后以不同 serverUrl 重新登录，旧服务器的消息会残留在 state 中，
    // 并通过 history 事件的合并逻辑混入新服务器的历史记录。
    // 解决方案：监听 serverUrl 变化，每次切换时重新从 localStorage 加载对应服务器的消息。
    useEffect(() => {
        setMessages(loadMessages(serverUrl));
    }, [serverUrl]);

    /**
     * 建立 WebSocket 连接，注册所有事件处理器，并在连接成功后发送 `join` 事件。
     *
     * 防重入机制：通过 `isConnecting` ref 与 `WebSocket.OPEN` 状态检测，
     * 确保同一时刻只有一个连接建立流程在进行，避免并发创建多个连接。
     *
     * 重连机制：在 `onclose` 回调中采用指数退避策略调度下一次重连，
     * 通过 `connectRef` 引用最新的 `connect` 函数，规避 TDZ 问题。
     */
    const connect = useCallback(() => {
        if (!serverUrl || !nickname) return;
        if (isConnecting.current) return;
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        isConnecting.current = true;
        clearReconnectTimer(); // 建立新连接前先取消已有的重连定时器

        try {
            const ws = new WebSocket(`ws://${serverUrl}/ws`);
            wsRef.current = ws;

            ws.onopen = () => {
                isConnecting.current = false;
                reconnectAttempts.current = 0; // 连接成功，重置重连计数
                setConnected(true);
                // 发送 join 事件，告知服务器客户端昵称与唯一 ID
                const joinEvent: WsSendEvent = {
                    event: "join",
                    data: {
                        nickname: nicknameRef.current,
                        client_id: getStableClientId(),
                    },
                };
                ws.send(JSON.stringify(joinEvent));
            };

            ws.onmessage = (e) => {
                try {
                    const event = JSON.parse(e.data) as WsEvent;
                    switch (event.event) {
                        case "welcome":
                            setMyUserId(event.data.user_id);
                            break;
                        case "users":
                            setUsers(event.data);
                            break;
                        case "message":
                            setMessages((prev) => {
                                // 去重：相同 id 的消息不重复添加
                                if (prev.some((m) => m.id === event.data.id))
                                    return prev;
                                return [...prev, event.data];
                            });
                            break;
                        case "history": {
                            const serverHistory: ChatMessage[] =
                                event.data ?? [];
                            // 合并：服务端历史 + 本地独有消息（按时间戳排序）
                            // 本地独有消息仅保留属于当前服务器的内容（id 不在服务端历史中）
                            setMessages((local) => {
                                const serverIds = new Set(
                                    serverHistory.map((m) => m.id),
                                );
                                const localOnly = local.filter(
                                    (m) => m.id && !serverIds.has(m.id),
                                );
                                const merged = [...serverHistory, ...localOnly];
                                merged.sort(
                                    (a, b) => a.timestamp - b.timestamp,
                                );
                                return merged;
                            });
                            break;
                        }
                    }
                } catch (err) {
                    console.error("WebSocket 消息解析失败:", err);
                }
            };

            ws.onclose = () => {
                isConnecting.current = false;
                setConnected(false);
                // 指数退避重连：延迟 = min(基础延迟 × 1.5^重连次数, 最大延迟)
                const cfg = getConfig();
                const delay = Math.min(
                    cfg.base_reconnect_delay_ms *
                        Math.pow(1.5, reconnectAttempts.current),
                    cfg.max_reconnect_delay_ms,
                );
                reconnectAttempts.current += 1;
                // 通过 ref 调用最新的 connect，避免直接引用 const 导致的 TDZ 问题
                reconnectTimer.current = setTimeout(() => {
                    connectRef.current();
                }, delay);
            };

            ws.onerror = () => {
                isConnecting.current = false;
                ws.close(); // 触发 onclose，由 onclose 负责重连调度
            };
        } catch {
            isConnecting.current = false;
        }
    }, [serverUrl, nickname, clearReconnectTimer]);

    // 每次 connect 重新生成后，同步更新 ref，确保 onclose 始终调用最新版本
    useLayoutEffect(() => {
        connectRef.current = connect;
    }, [connect]);

    useEffect(() => {
        if (serverUrl && nickname) {
            connect();
        }
        return () => {
            clearReconnectTimer();
            if (wsRef.current) {
                wsRef.current.onclose = null; // 置空 onclose，防止组件卸载时触发重连
                wsRef.current.close();
                wsRef.current = null;
            }
            isConnecting.current = false;
        };
    }, [connect, serverUrl, nickname, clearReconnectTimer]);

    // 消息变化时持久化到 localStorage
    useEffect(() => {
        if (serverUrl && messages.length > 0) {
            saveMessages(serverUrl, messages);
        }
    }, [messages, serverUrl]);

    /**
     * 通过 WebSocket 向指定接收方发送消息。
     *
     * 若当前 WebSocket 未处于 `OPEN` 状态，调用将被静默忽略。
     * 所有动态值（`myUserId`、`nickname`）均通过 ref 访问，
     * 因此依赖数组为空，callback 引用在整个组件生命周期内保持稳定。
     *
     * @param {string} toId - 接收方用户 ID；群发时传 `"all"`。
     * @param {string} content - 消息内容字符串；文件类消息时为服务器相对路径。
     * @param {"text" | "image" | "video" | "file"} [msgType="text"] - 消息类型，默认为文本。
     * @param {string} [fileName] - 文件原始名称，仅文件类消息时传入。
     * @param {number} [fileSize] - 文件大小（字节），仅文件类消息时传入。
     */
    const sendMessage = useCallback(
        (
            toId: string,
            content: string,
            msgType: "text" | "image" | "video" | "file" = "text",
            fileName?: string,
            fileSize?: number,
        ) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)
                return;
            const msg: WsSendEvent = {
                event: "message",
                data: {
                    id: "",
                    from_id: myUserIdRef.current,
                    from_name: nicknameRef.current,
                    to_id: toId,
                    content,
                    msg_type: msgType,
                    file_name: fileName,
                    file_size: fileSize,
                    timestamp: Date.now(),
                },
            };
            wsRef.current.send(JSON.stringify(msg));
        },
        [], // 无需依赖项，所有动态值均通过 ref 访问，避免过时闭包
    );

    /**
     * 将文件通过 HTTP POST 上传到聊天服务器，并在服务端自动广播对应消息。
     *
     * 上传地址为 `http://<serverUrl>/upload`，通过自定义请求头传递文件元信息：
     * - `x-file-name`：URL 编码后的原始文件名
     * - `x-from-id` / `x-from-name`：发送方身份信息
     * - `x-to-id`：接收方用户 ID
     * - `x-msg-type`：由 MIME 类型自动推断的消息类型
     *
     * 所有动态值均通过 ref 访问，callback 引用在整个组件生命周期内保持稳定。
     *
     * @param {File} file  - 用户选择或拖拽的文件对象。
     * @param {string} toId - 接收方用户 ID；群发时传 `"all"`。
     * @returns {Promise<string | null>} 上传成功后服务器返回的文件相对 URL（如 `/files/xxx.png`）；
     *   上传失败时返回 `null`。
     */
    const uploadFile = useCallback(
        async (file: File, toId: string): Promise<string | null> => {
            // 根据 MIME 类型判断消息类别
            const msgType: "image" | "video" | "file" = file.type.startsWith(
                "image/",
            )
                ? "image"
                : file.type.startsWith("video/")
                  ? "video"
                  : "file";

            try {
                const arrayBuffer = await file.arrayBuffer();
                const response = await fetch(
                    `http://${serverUrlRef.current}/upload`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/octet-stream",
                            "x-file-name": encodeURIComponent(file.name),
                            "x-from-id": myUserIdRef.current,
                            "x-from-name": nicknameRef.current,
                            "x-to-id": toId,
                            "x-msg-type": msgType,
                        },
                        body: arrayBuffer,
                    },
                );
                if (!response.ok) {
                    console.error("文件上传 HTTP 错误:", response.status);
                    return null;
                }
                const result = await response.json();
                return result.ok ? result.url : null;
            } catch (err) {
                console.error("文件上传失败:", err);
                return null;
            }
        },
        [], // 无需依赖项，所有动态值均通过 ref 访问，避免过时闭包
    );

    return {
        connected,
        myUserId,
        users,
        messages,
        sendMessage,
        uploadFile,
    };
}
