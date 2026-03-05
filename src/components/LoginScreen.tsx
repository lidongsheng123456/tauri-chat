import { ArrowRight, ChevronDown, Monitor, Network, Sparkles, Users, Wifi } from "lucide-react";
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
  // Initialize state using a callback to avoid useEffect warnings
  const [nickname, setNickname] = useState(() => hostname || "");
  const [selectedIp, setSelectedIp] = useState(() =>
    networkInterfaces.length > 0 ? networkInterfaces[0].ip : ""
  );

  const [serverIp, setServerIp] = useState("");
  const [isHost, setIsHost] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Still update if networkInterfaces changes drastically and we have no selectedIp
  useEffect(() => {
    if (networkInterfaces.length > 0 && !selectedIp) {
      setSelectedIp(networkInterfaces[0].ip);
    }
  }, [networkInterfaces, selectedIp]);

  // Sync hostname if it comes in late
  useEffect(() => {
    if (hostname && !nickname) {
      setNickname(hostname);
    }
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
    <div className="login-screen">
      {/* Premium Aurora Background */}
      <div className="login-aurora">
        <div className="login-aurora-blob login-aurora-blob--1 animate-aurora" />
        <div className="login-aurora-blob login-aurora-blob--2 animate-aurora" style={{ animationDelay: "-7s" }} />
      </div>

      <div className="login-card-wrapper animate-slide-up">
        {/* Card */}
        <div className="login-card">
          {/* Header */}
          <div className="login-header">
            <div className="login-icon">
              <Sparkles size={32} />
            </div>
            <h1 className="login-title">LAN Chat</h1>
            <p className="login-subtitle">极速内网通讯 · 安全文件传输</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            {/* Nickname Input */}
            <div>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="您的专属昵称"
                className="form-input"
                autoFocus
              />
            </div>

            {/* Mode Toggle (Apple Style Segmented Control) */}
            <div className="segmented-control">
              <button
                type="button"
                onClick={() => setIsHost(true)}
                className={`segmented-btn ${isHost ? "segmented-btn--active" : ""}`}
              >
                <Monitor size={16} />
                创建房间
              </button>
              <button
                type="button"
                onClick={() => setIsHost(false)}
                className={`segmented-btn ${!isHost ? "segmented-btn--active" : ""}`}
              >
                <Users size={16} />
                加入房间
              </button>
            </div>

            {/* Dynamic Content Area */}
            <div className="network-area">
              {isHost ? (
                <div className="network-selector animate-fade-in" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowDropdown(!showDropdown)}
                    className={`network-trigger ${showDropdown ? "network-trigger--open" : ""}`}
                  >
                    <div className="network-trigger__icon">
                      <Network size={20} />
                    </div>
                    <div className="network-trigger__info">
                      <div className="network-trigger__ip">{selectedIp || "选择网络接口"}</div>
                      {selectedInterface && (
                        <div className="network-trigger__name">{selectedInterface.name}</div>
                      )}
                    </div>
                    <ChevronDown size={20} className={`network-trigger__chevron ${showDropdown ? "network-trigger__chevron--open" : ""}`} />
                  </button>

                  {showDropdown && (
                    <div className="network-dropdown animate-fade-in">
                      {networkInterfaces.map((iface) => (
                        <button
                          key={iface.ip}
                          type="button"
                          onClick={() => { setSelectedIp(iface.ip); setShowDropdown(false); }}
                          className={`network-option ${iface.ip === selectedIp ? "network-option--selected" : ""}`}
                        >
                          <Wifi size={16} className="network-option__icon" />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="network-option__ip">{iface.ip}</div>
                            <div className="network-option__name">{iface.name}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="join-input-wrapper animate-fade-in">
                  <input
                    type="text"
                    value={serverIp}
                    onChange={(e) => setServerIp(e.target.value)}
                    placeholder="输入服务器 IP (如: 192.168.1.100)"
                    className="join-input"
                  />
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="login-submit"
            >
              {isHost ? "开启聊天空间" : "加入聊天空间"}
              <ArrowRight size={16} className="login-submit__arrow" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
