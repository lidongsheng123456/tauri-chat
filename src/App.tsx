import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatWindow } from "./components/ChatWindow";
import { LoginScreen } from "./components/LoginScreen";
import { UserList } from "./components/UserList";
import { useChat } from "./hooks/useChat";

interface NetworkInterface {
  name: string;
  ip: string;
}

async function tauriInvoke<T>(cmd: string): Promise<T | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd);
  } catch {
    return null;
  }
}

function App() {
  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterface[]>([]);
  const [hostname, setHostname] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [nickname, setNickname] = useState("");
  const [serverIp, setServerIp] = useState("");
  const [selectedChat, setSelectedChat] = useState("all");

  const serverUrl = useMemo(() => `${serverIp}:9120`, [serverIp]);

  const { connected, myUserId, users, messages, sendMessage, uploadFile } = useChat({
    serverUrl: loggedIn ? serverUrl : "",
    nickname: loggedIn ? nickname : "",
  });

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

  const handleLogin = useCallback((nick: string, ip: string) => {
    setNickname(nick);
    setServerIp(ip);
    setLoggedIn(true);
  }, []);

  const handleSendMessage = useCallback(
    (content: string) => {
      sendMessage(selectedChat, content, "text");
    },
    [sendMessage, selectedChat]
  );

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
    <div className="app-layout">
      <UserList
        users={users}
        myUserId={myUserId}
        selectedChat={selectedChat}
        onSelectChat={setSelectedChat}
        connected={connected}
        serverIp={serverIp}
      />
      <ChatWindow
        messages={messages}
        myUserId={myUserId}
        selectedChat={selectedChat}
        users={users}
        serverUrl={serverUrl}
        onSendMessage={handleSendMessage}
        onUploadFile={handleUploadFile}
      />
    </div>
  );
}

export default App;
