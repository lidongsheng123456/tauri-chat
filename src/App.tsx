import { useCallback, useEffect, useMemo, useState } from "react";
import { tauriInvoke } from "./utils/tauri";
import { AiChatWindow } from "./components/AiChatWindow";
import { ChatWindow } from "./components/ChatWindow";
import { LoginScreen } from "./components/LoginScreen";
import { TransferIndicator } from "./components/TransferIndicator";
import { UserList } from "./components/UserList";
import { getConfig, loadConfig } from "./config";
import { AI_BOT_ID, useAiChat } from "./hooks/useAiChat";
import { useChat } from "./hooks/useChat";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { TransferProvider } from "./hooks/useTransfers";

/**
 * 本机网络接口信息，由 Tauri Command `get_all_ips` 返回。
 *
 * 对应 Rust 端的 `NetworkInterface` 结构体，字段命名保持一致。
 */
interface NetworkInterface {
    /** 网络接口的操作系统名称，例如 `"WLAN"` 或 `"以太网"`。 */
    name: string;
    /** 该接口绑定的 IPv4 地址字符串，格式为点分十进制（如 `"192.168.1.100"`）。 */
    ip: string;
}

/**
 * 登录会话数据，持久化到 `localStorage` 中，用于应用重启后自动恢复登录状态。
 */
interface SessionData {
    /** 用户上次登录时填写的昵称。 */
    nickname: string;
    /** 用户上次连接的服务器 IP 地址。 */
    serverIp: string;
}

/**
 * 应用根组件，负责管理以下全局状态与业务逻辑：
 * - 登录/登出流程与 Session 持久化
 * - 聊天连接（WebSocket）与 AI 对话切换
 * - 消息收发与文件上传的统一入口
 * - 网络接口列表与主机名的初始化加载
 *
 * 渲染树结构：
 * - 未登录 → `LoginScreen`
 * - 已登录 → `TransferProvider` > `UserList` + (`AiChatWindow` | `ChatWindow`) + `TransferIndicator`
 */
function App() {
    const [networkInterfaces, setNetworkInterfaces] = useState<
        NetworkInterface[]
    >([]);
    const [hostname, setHostname] = useState("");
    const [session, setSession, removeSession] =
        useLocalStorage<SessionData | null>("lanchat_session", null);
    const [loggedIn, setLoggedIn] = useState(() => session !== null);
    const [nickname, setNickname] = useState(() => session?.nickname ?? "");
    const [serverIp, setServerIp] = useState(() => session?.serverIp ?? "");
    const [selectedChat, setSelectedChat] = useState("all");

    /**
     * 由 `serverIp` 与配置端口派生的完整服务器地址（`host:port` 格式），
     * 作为 WebSocket 连接地址的一部分传入 `useChat`。
     * 使用 `useMemo` 避免每次渲染都重新生成字符串。
     */
    const serverUrl = useMemo(
        () => `${serverIp}:${getConfig().chat_port}`,
        [serverIp],
    );

    const { connected, myUserId, users, messages, sendMessage, uploadFile } =
        useChat({
            serverUrl: loggedIn ? serverUrl : "",
            nickname: loggedIn ? nickname : "",
        });

    const aiChat = useAiChat();

    /**
     * 应用初始化副作用：依次完成以下操作：
     * 1. 调用 `loadConfig` 从后端加载并缓存运行时配置。
     * 2. 调用 `get_all_ips` 获取本机所有非回环 IPv4 接口列表；若无可用接口则降级为 localhost。
     * 3. 调用 `get_hostname` 获取本机主机名，用于登录界面的昵称默认值。
     *
     * 对应 Rust Commands: `get_all_ips`、`get_hostname`
     */
    useEffect(() => {
        async function init() {
            await loadConfig();
            const interfaces =
                await tauriInvoke<NetworkInterface[]>("get_all_ips");
            if (interfaces && interfaces.length > 0) {
                setNetworkInterfaces(interfaces);
            } else {
                setNetworkInterfaces([{ name: "localhost", ip: "127.0.0.1" }]);
            }
            const host = await tauriInvoke<string>("get_hostname");
            if (host) setHostname(host);
        }
        init();
    }, []);

    /**
     * 处理用户登录：更新昵称、服务器 IP 与登录状态，同时将会话数据写入 `localStorage`。
     *
     * @param {string} nick - 用户填写的昵称。
     * @param {string} ip   - 用户选择或输入的服务器 IP 地址。
     */
    const handleLogin = useCallback(
        (nick: string, ip: string) => {
            setNickname(nick);
            setServerIp(ip);
            setLoggedIn(true);
            setSession({ nickname: nick, serverIp: ip });
        },
        [setSession],
    );

    /**
     * 处理用户登出：重置所有登录状态，并从 `localStorage` 中删除会话记录。
     * WebSocket 连接会因 `useChat` 的依赖变化而自动断开。
     */
    const handleLogout = useCallback(() => {
        setLoggedIn(false);
        setNickname("");
        setServerIp("");
        removeSession();
    }, [removeSession]);

    /**
     * 向当前选中的会话发送纯文本消息。
     *
     * 对 `useChat.sendMessage` 的封装，固定 `msgType` 为 `"text"`，
     * 屏蔽底层参数细节，保持事件处理器接口简洁。
     *
     * @param {string} content - 要发送的消息文本内容。
     */
    const handleSendMessage = useCallback(
        (content: string) => {
            sendMessage(selectedChat, content, "text");
        },
        [sendMessage, selectedChat],
    );

    /**
     * 将选定文件上传至当前选中会话的接收方。
     *
     * 对 `useChat.uploadFile` 的异步封装，使调用方无需感知底层的 `toId` 参数。
     * `uploadFile` 内部已 catch 所有网络错误并返回 `null`，此处将 `null` 转换为
     * throw，确保调用方（`ChatInput.handleFileChange`、`ChatWindow.handleDrop`）
     * 的 try/catch 能正常命中 catch 分支，从而正确更新 TransferIndicator 状态。
     *
     * @param {File} file - 用户通过文件选择器或拖拽方式选取的文件对象。
     * @returns {Promise<void>}
     * @throws {Error} 若 HTTP 上传请求失败或服务端返回非 ok 响应，抛出包含文件名的错误。
     */
    const handleUploadFile = useCallback(
        async (file: File) => {
            const result = await uploadFile(file, selectedChat);
            if (result === null) throw new Error(`"${file.name}" 上传失败`);
        },
        [uploadFile, selectedChat],
    );

    if (!loggedIn) {
        return (
            <LoginScreen
                onLogin={handleLogin}
                networkInterfaces={networkInterfaces}
                hostname={hostname}
            />
        );
    }

    return (
        <TransferProvider>
            <div className="app-layout">
                <UserList
                    users={users}
                    myUserId={myUserId}
                    selectedChat={selectedChat}
                    onSelectChat={setSelectedChat}
                    connected={connected}
                    serverIp={serverIp}
                    onLogout={handleLogout}
                />
                {selectedChat === AI_BOT_ID ? (
                    <AiChatWindow
                        chatMessages={aiChat.chatMessages}
                        isLoading={aiChat.isLoading}
                        toolStatus={aiChat.toolStatus}
                        onSendMessage={aiChat.sendMessage}
                        onClearHistory={aiChat.clearHistory}
                    />
                ) : (
                    <ChatWindow
                        messages={messages}
                        myUserId={myUserId}
                        selectedChat={selectedChat}
                        users={users}
                        serverUrl={serverUrl}
                        onSendMessage={handleSendMessage}
                        onUploadFile={handleUploadFile}
                    />
                )}
                <TransferIndicator />
            </div>
        </TransferProvider>
    );
}

export default App;
