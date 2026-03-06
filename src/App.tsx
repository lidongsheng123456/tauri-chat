import { useCallback, useEffect, useMemo, useState } from "react";
import { AiChatWindow } from "./components/AiChatWindow";
import { ChatWindow } from "./components/ChatWindow";
import { LoginScreen } from "./components/LoginScreen";
import { TransferIndicator } from "./components/TransferIndicator";
import { UserList } from "./components/UserList";
import { AI_BOT_ID, useAiChat } from "./hooks/useAiChat";
import { useChat } from "./hooks/useChat";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { TransferProvider } from "./hooks/useTransfers";

/** 网络接口信息 */
interface NetworkInterface {
  name: string;
  ip: string;
}

/** 登录会话数据 */
interface SessionData {
  nickname: string;
  serverIp: string;
}

/** 调用 Tauri 后端命令，失败时返回 null */
async function tauriInvoke<T>(cmd: string): Promise<T | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd);
  } catch {
    return null;
  }
}

/** 应用根组件 - 管理登录状态、聊天/AI 切换、消息与文件传输 */
function App() {
  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterface[]>([]);
  const [hostname, setHostname] = useState("");
  const [session, setSession, removeSession] = useLocalStorage<SessionData | null>("lanchat_session", null);
  const [loggedIn, setLoggedIn] = useState(() => session !== null);
  const [nickname, setNickname] = useState(() => session?.nickname ?? "");
  const [serverIp, setServerIp] = useState(() => session?.serverIp ?? "");
  const [selectedChat, setSelectedChat] = useState("all");

  const serverUrl = useMemo(() => `${serverIp}:9120`, [serverIp]);

  const { connected, myUserId, users, messages, sendMessage, uploadFile } = useChat({
    serverUrl: loggedIn ? serverUrl : "",
    nickname: loggedIn ? nickname : "",
  });

  const aiChat = useAiChat();

  useEffect(() => {
    async function init() {
      const interfaces = await tauriInvoke<NetworkInterface[]>("get_all_ips");
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

  /** 处理登录：保存昵称与服务器 IP，写入 session */
  const handleLogin = useCallback((nick: string, ip: string) => {
    setNickname(nick);
    setServerIp(ip);
    setLoggedIn(true);
    setSession({ nickname: nick, serverIp: ip });
  }, [setSession]);

  /** 处理登出：清除 session 与本地状态 */
  const handleLogout = useCallback(() => {
    setLoggedIn(false);
    setNickname("");
    setServerIp("");
    removeSession();
  }, [removeSession]);

  /** 向当前选中会话发送文本消息 */
  const handleSendMessage = useCallback(
    (content: string) => {
      sendMessage(selectedChat, content, "text");
    },
    [sendMessage, selectedChat]
  );

  /** 向当前选中会话上传文件 */
  const handleUploadFile = useCallback(
    async (file: File) => {
      await uploadFile(file, selectedChat);
    },
    [uploadFile, selectedChat]
  );

  if (!loggedIn) {
    return <LoginScreen onLogin={handleLogin} networkInterfaces={networkInterfaces} hostname={hostname} />;
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
