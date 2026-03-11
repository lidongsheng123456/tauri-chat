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

/**
 * 网络接口信息，由父组件通过 Tauri Command `get_all_ips` 获取后传入。
 */
interface NetworkInterface {
    /** 网络接口的操作系统名称，例如 `"WLAN"` 或 `"以太网"`。 */
    name: string;
    /** 该接口绑定的 IPv4 地址，格式为点分十进制（如 `"192.168.1.100"`）。 */
    ip: string;
}

/**
 * `LoginScreen` 组件的 Props。
 */
interface LoginScreenProps {
    /**
     * 用户点击提交按钮后的回调，携带最终确认的昵称与服务器 IP。
     *
     * @param {string} nickname  - 用户输入的昵称（已去除首尾空格）。
     * @param {string} serverIp  - 创建房间模式下为所选网络接口的 IP；加入房间模式下为用户输入的服务器 IP。
     */
    onLogin: (nickname: string, serverIp: string) => void;
    /** 本机所有可用的非回环 IPv4 网络接口列表，由父组件异步加载后传入。 */
    networkInterfaces: NetworkInterface[];
    /** 本机的操作系统主机名，用作昵称输入框的默认值。 */
    hostname: string;
}

/**
 * 登录界面组件，支持「创建房间」（作为服务端）与「加入房间」（连接已有服务端）两种模式。
 *
 * 设计要点：
 * - `networkInterfaces` 与 `hostname` 为异步到达的 Props，通过渲染时派生计算值
 *   （`displayIp` / `displayNickname`）直接驱动 UI，避免在 `useEffect` 中调用
 *   `setState` 产生级联渲染。
 * - 下拉框展开时通过 `useEffect` 监听全局 `mousedown` 事件以实现「点击外部关闭」，
 *   关闭时自动移除监听器，防止内存泄漏。
 *
 * @param {LoginScreenProps} props - 组件 Props，详见 `LoginScreenProps` 接口定义。
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

    /**
     * 处理表单提交：校验昵称与 IP 均非空后调用 `onLogin` 回调。
     *
     * 使用派生值（`displayNickname` / `displayIp`）作为最终提交数据，
     * 确保昵称默认值（主机名）与 IP 默认值（第一个接口）在未手动修改时也能正确提交。
     *
     * @param {React.FormEvent} e - 表单提交事件，调用 `preventDefault` 阻止页面刷新。
     */
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
