import {
    ArrowRight,
    ChevronDown,
    Monitor,
    Network,
    Sparkles,
    Users,
    Wifi,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** 网络接口 */
interface NetworkInterface {
    name: string;
    ip: string;
}

/** 登录页 Props */
interface LoginScreenProps {
    onLogin: (nickname: string, serverIp: string) => void;
    networkInterfaces: NetworkInterface[];
    hostname: string;
}

/**
 * 登录界面组件 - 支持创建房间和加入房间两种模式
 *
 * 异步到达的 networkInterfaces 和 hostname 通过渲染时派生计算值（displayIp /
 * displayNickname）直接驱动 UI，避免在 useEffect 中调用 setState 产生级联渲染。
 */
export function LoginScreen({
    onLogin,
    networkInterfaces,
    hostname,
}: LoginScreenProps) {
    // 用户主动选择的 IP（空字符串表示尚未手动选择，回退到 displayIp 派生值）
    const [selectedIp, setSelectedIp] = useState("");
    // 用户输入的昵称（空字符串时回退到 displayNickname 派生值）
    const [nickname, setNickname] = useState("");
    const [serverIp, setServerIp] = useState("");
    const [isHost, setIsHost] = useState(true);
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // ── 派生值（渲染时计算，无需 useEffect + setState）────────────────────────
    // 优先使用用户手动选中的 IP，否则自动取第一个网络接口
    const displayIp = selectedIp || networkInterfaces[0]?.ip || "";
    // 优先使用用户输入的昵称，否则回退到系统主机名
    const displayNickname = nickname || hostname;

    const selectedInterface = networkInterfaces.find((i) => i.ip === displayIp);
    const canSubmit =
        displayNickname.trim() && (isHost ? displayIp : serverIp.trim());

    // 下拉框展开时监听全局点击，点击外部时关闭（订阅外部事件，是 useEffect 的合理用途）
    useEffect(() => {
        if (!showDropdown) return;
        function handleClickOutside(e: MouseEvent) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(e.target as Node)
            ) {
                setShowDropdown(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    }, [showDropdown]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const nick = displayNickname.trim();
        const ip = isHost ? displayIp : serverIp.trim();
        if (!nick || !ip) return;
        onLogin(nick, ip);
    };

    return (
        <div className="login-screen">
            {/* 极光渐变背景 */}
            <div className="login-aurora">
                <div className="login-aurora-blob login-aurora-blob--1 animate-aurora" />
                <div
                    className="login-aurora-blob login-aurora-blob--2 animate-aurora"
                    style={{ animationDelay: "-7s" }}
                />
            </div>

            <div className="login-card-wrapper animate-slide-up">
                {/* 登录卡片 */}
                <div className="login-card">
                    {/* 顶部标题区域 */}
                    <div className="login-header">
                        <div className="login-icon">
                            <Sparkles size={32} />
                        </div>
                        <h1 className="login-title">LAN Chat</h1>
                        <p className="login-subtitle">
                            极速内网通讯 · 安全文件传输
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="login-form">
                        {/* 昵称输入框：value 用派生值，onChange 写入独立 state */}
                        <div>
                            <input
                                type="text"
                                value={displayNickname}
                                onChange={(e) => setNickname(e.target.value)}
                                placeholder="您的专属昵称"
                                className="form-input"
                                autoFocus
                            />
                        </div>

                        {/* 模式切换（Apple 风格分段控件） */}
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

                        {/* 动态内容区（创建/加入房间） */}
                        <div className="network-area">
                            {isHost ? (
                                <div
                                    className="network-selector animate-fade-in"
                                    ref={dropdownRef}
                                >
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowDropdown(!showDropdown)
                                        }
                                        className={`network-trigger ${showDropdown ? "network-trigger--open" : ""}`}
                                    >
                                        <div className="network-trigger__icon">
                                            <Network size={20} />
                                        </div>
                                        <div className="network-trigger__info">
                                            <div className="network-trigger__ip">
                                                {displayIp || "选择网络接口"}
                                            </div>
                                            {selectedInterface && (
                                                <div className="network-trigger__name">
                                                    {selectedInterface.name}
                                                </div>
                                            )}
                                        </div>
                                        <ChevronDown
                                            size={20}
                                            className={`network-trigger__chevron ${showDropdown ? "network-trigger__chevron--open" : ""}`}
                                        />
                                    </button>

                                    {showDropdown && (
                                        <div className="network-dropdown animate-fade-in">
                                            {networkInterfaces.map((iface) => (
                                                <button
                                                    key={iface.ip}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedIp(iface.ip);
                                                        setShowDropdown(false);
                                                    }}
                                                    className={`network-option ${iface.ip === displayIp ? "network-option--selected" : ""}`}
                                                >
                                                    <Wifi
                                                        size={16}
                                                        className="network-option__icon"
                                                    />
                                                    <div
                                                        style={{
                                                            minWidth: 0,
                                                            flex: 1,
                                                        }}
                                                    >
                                                        <div className="network-option__ip">
                                                            {iface.ip}
                                                        </div>
                                                        <div className="network-option__name">
                                                            {iface.name}
                                                        </div>
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
                                        onChange={(e) =>
                                            setServerIp(e.target.value)
                                        }
                                        placeholder="输入服务器 IP (如: 192.168.1.100)"
                                        className="join-input"
                                    />
                                </div>
                            )}
                        </div>

                        {/* 提交按钮 */}
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="login-submit"
                        >
                            {isHost ? "开启聊天空间" : "加入聊天空间"}
                            <ArrowRight
                                size={16}
                                className="login-submit__arrow"
                            />
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
