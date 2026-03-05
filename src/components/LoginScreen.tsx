import { ArrowRight, ChevronDown, MessageCircle, Monitor, Network, Users, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface NetworkInterface {
  name: string;
  ip: string;
}

interface LoginScreenProps {
  onLogin: (nickname: string, serverIp: string) => void;
  networkInterfaces: NetworkInterface[];
  hostname: string;
}

export function LoginScreen({ onLogin, networkInterfaces, hostname }: LoginScreenProps) {
  const [nickname, setNickname] = useState(hostname || "");
  const [selectedIp, setSelectedIp] = useState("");
  const [serverIp, setServerIp] = useState("");
  const [isHost, setIsHost] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (networkInterfaces.length > 0 && !selectedIp) {
      setSelectedIp(networkInterfaces[0].ip);
    }
  }, [networkInterfaces, selectedIp]);

  useEffect(() => {
    if (hostname && !nickname) setNickname(hostname);
  }, [hostname, nickname]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showDropdown]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    const ip = isHost ? selectedIp : serverIp.trim();
    if (!ip) return;
    onLogin(nickname.trim(), ip);
  };

  const selectedInterface = networkInterfaces.find(i => i.ip === selectedIp);
  const canSubmit = nickname.trim() && (isHost ? selectedIp : serverIp.trim());

  return (
    <div className="h-full w-full flex items-center justify-center bg-[#12132a] relative overflow-hidden">
      {/* Background decorative orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-[420px] h-[420px] bg-accent/10 rounded-full blur-[100px] animate-float" />
        <div className="absolute -bottom-32 -left-32 w-[350px] h-[350px] bg-[#a78bfa]/10 rounded-full blur-[100px] animate-float" style={{ animationDelay: "2s" }} />
      </div>

      <div className="relative animate-scale-in w-[440px] max-w-[92vw]">
        {/* Card */}
        <div className="bg-[#1e2040]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl shadow-black/40">
          {/* Logo & Title */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-accent/15 border border-accent/20 rounded-2xl flex items-center justify-center mb-4">
              <MessageCircle className="w-8 h-8 text-accent" />
            </div>
            <h1 className="text-2xl font-bold text-white">LAN Chat</h1>
            <p className="text-sidebar-muted text-sm mt-1">内网即时通讯 · 文件传输</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nickname */}
            <div>
              <label className="block text-xs font-medium text-sidebar-muted mb-1.5">昵称</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="输入你的昵称"
                className="w-full px-4 py-3 bg-white/8 border border-white/10 rounded-xl text-white text-sm placeholder-white/30 focus:border-accent/50 focus:bg-white/10 focus:ring-1 focus:ring-accent/25 outline-none transition-all duration-200"
                autoFocus
              />
            </div>

            {/* Mode Toggle */}
            <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-white/5 rounded-xl">
              <button
                type="button"
                onClick={() => setIsHost(true)}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${isHost
                  ? "bg-accent text-white shadow-md shadow-accent/25"
                  : "text-sidebar-muted hover:text-white hover:bg-white/5"
                  }`}
              >
                <Monitor className="w-4 h-4" />
                创建房间
              </button>
              <button
                type="button"
                onClick={() => setIsHost(false)}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${!isHost
                  ? "bg-accent text-white shadow-md shadow-accent/25"
                  : "text-sidebar-muted hover:text-white hover:bg-white/5"
                  }`}
              >
                <Users className="w-4 h-4" />
                加入房间
              </button>
            </div>

            {/* Host: Network Interface Selector */}
            {isHost && (
              <div className="animate-fade-in">
                <label className="block text-xs font-medium text-sidebar-muted mb-1.5">选择网络接口</label>
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowDropdown(!showDropdown)}
                    className={`w-full flex items-center gap-3 px-4 py-3 bg-white/8 border rounded-xl text-white cursor-pointer hover:bg-white/10 transition-all duration-200 ${showDropdown ? "border-accent/50 ring-1 ring-accent/25" : "border-white/10"}`}
                  >
                    <div className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
                      <Network className="w-4.5 h-4.5 text-accent" />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-sm font-mono truncate">{selectedIp || "选择网络..."}</div>
                      {selectedInterface && (
                        <div className="text-xs text-sidebar-muted truncate mt-0.5">{selectedInterface.name}</div>
                      )}
                    </div>
                    <ChevronDown className={`w-4 h-4 text-sidebar-muted shrink-0 transition-transform duration-200 ${showDropdown ? "rotate-180" : ""}`} />
                  </button>

                  {showDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#252747] border border-white/12 rounded-xl overflow-hidden shadow-xl shadow-black/50 z-20 animate-fade-in max-h-[200px] overflow-y-auto">
                      {networkInterfaces.map((iface) => (
                        <button
                          key={iface.ip}
                          type="button"
                          onClick={() => { setSelectedIp(iface.ip); setShowDropdown(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer transition-colors duration-150 ${iface.ip === selectedIp
                            ? "bg-accent/15 text-accent"
                            : "text-sidebar-text hover:bg-white/8"
                            }`}
                        >
                          <Wifi className={`w-4 h-4 shrink-0 ${iface.ip === selectedIp ? "text-accent" : "text-sidebar-muted"}`} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-mono truncate">{iface.ip}</div>
                            <div className="text-xs text-sidebar-muted truncate">{iface.name}</div>
                          </div>
                          {iface.ip === selectedIp && (
                            <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Join: Server IP input */}
            {!isHost && (
              <div className="animate-fade-in">
                <label className="block text-xs font-medium text-sidebar-muted mb-1.5">服务器 IP</label>
                <input
                  type="text"
                  value={serverIp}
                  onChange={(e) => setServerIp(e.target.value)}
                  placeholder="例如: 192.168.1.100"
                  className="w-full px-4 py-3 bg-white/8 border border-white/10 rounded-xl text-white text-sm placeholder-white/30 focus:border-accent/50 focus:bg-white/10 focus:ring-1 focus:ring-accent/25 outline-none transition-all duration-200 font-mono"
                />
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-3 bg-accent text-white font-semibold rounded-xl hover:bg-accent-hover active:scale-[0.98] transition-all duration-200 shadow-lg shadow-accent/25 disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100 flex items-center justify-center gap-2 cursor-pointer text-sm mt-2"
            >
              {isHost ? "创建并进入" : "连接并加入"}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Footer hint */}
          <p className="text-center text-xs text-sidebar-muted/60 mt-5">局域网内无需互联网 · 安全可靠</p>
        </div>
      </div>
    </div>
  );
}
