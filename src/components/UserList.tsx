import { LogOut, Search, Users } from "lucide-react";
import { useState } from "react";
import { getConfig } from "../config";
import { AI_BOT_ID } from "../hooks/useAiChat";
import { getAvatarColorClass } from "../utils/avatar";
import { type UserInfo } from "../types";

/**
 * `UserList` 组件的 Props。
 */
interface UserListProps {
    /** 当前所有在线用户列表，由 `useChat` Hook 通过 WebSocket `users` 事件维护。 */
    users: UserInfo[];
    /** 当前客户端自身的用户 ID，用于从用户列表中过滤掉自己。 */
    myUserId: string;
    /** 当前选中的会话 ID：`"all"` 表示群聊，`AI_BOT_ID` 表示 AI 助手，其他值为私聊对象的用户 ID。 */
    selectedChat: string;
    /**
     * 切换当前选中会话的回调。
     *
     * @param {string} userId - 目标会话 ID，可为 `"all"`、`AI_BOT_ID` 或某个用户的 `user_id`。
     */
    onSelectChat: (userId: string) => void;
    /** WebSocket 当前连接状态，用于在侧边栏顶部显示「已连接」或「断开」状态指示器。 */
    connected: boolean;
    /** 当前连接的服务器 IP 地址，显示在侧边栏的服务器信息栏中。 */
    serverIp: string;
    /**
     * 可选的登出回调，点击退出按钮时触发。
     * 不传则不渲染退出按钮。
     */
    onLogout?: () => void;
}

/**
 * 侧边栏用户列表组件，展示群聊、AI 助手入口与所有在线私聊用户。
 *
 * 功能说明：
 * - 顶部显示连接状态指示器（绿点/红点）与搜索框。
 * - 搜索框对其他在线用户的昵称进行实时不区分大小写的过滤。
 * - 固定展示「所有人频道」（群聊）与「AI 助手」两个入口，不受搜索过滤影响。
 * - 当搜索无结果时显示空状态提示。
 * - 每个用户头像使用 `getAvatarColorClass` 根据昵称生成确定性颜色，并在右下角显示在线绿点。
 *
 * @param {UserListProps} props - 组件 Props，详见 `UserListProps` 接口定义。
 */
export function UserList({
    users,
    myUserId,
    selectedChat,
    onSelectChat,
    connected,
    serverIp,
    onLogout,
}: UserListProps) {
    const otherUsers = users.filter((u) => u.user_id !== myUserId);
    const [searchQuery, setSearchQuery] = useState("");

    /** 搜索框有内容时对其他用户列表按昵称进行不区分大小写的过滤 */
    const filteredUsers = searchQuery
        ? otherUsers.filter((u) =>
              u.nickname.toLowerCase().includes(searchQuery.toLowerCase()),
          )
        : otherUsers;

    return (
        <div className="sidebar">
            {/* 顶部标题与搜索框 */}
            <div className="sidebar-header">
                <div className="sidebar-header__top">
                    <h2 className="sidebar-title">消息</h2>
                    <div className="sidebar-status">
                        <span
                            className={`sidebar-status__dot ${connected ? "sidebar-status__dot--online" : "sidebar-status__dot--offline"}`}
                        />
                        <span className="sidebar-status__text">
                            {connected ? "已连接" : "断开"}
                        </span>
                    </div>
                </div>

                <div className="sidebar-search">
                    <Search size={16} className="sidebar-search__icon" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索联系人..."
                        className="sidebar-search__input"
                    />
                </div>
            </div>

            {/* 服务器连接信息与退出按钮 */}
            <div className="sidebar-server-info">
                <span>
                    Server: {serverIp}:{getConfig().chat_port}
                </span>
                {onLogout && (
                    <button
                        onClick={onLogout}
                        className="sidebar-logout-btn"
                        title="退出登录"
                    >
                        <LogOut size={14} />
                    </button>
                )}
            </div>

            {/* 会话列表：群聊 + AI 助手 + 在线用户私聊 */}
            <div className="sidebar-list">
                <div className="sidebar-list__spacer" />

                {/* 群聊频道入口 */}
                <button
                    onClick={() => onSelectChat("all")}
                    className={`sidebar-item ${selectedChat === "all" ? "sidebar-item--active" : ""}`}
                >
                    <div className="avatar avatar--group">
                        <Users size={20} />
                    </div>
                    <div className="sidebar-item__info">
                        <div className="sidebar-item__row">
                            <span className="sidebar-item__name">
                                所有人频道
                            </span>
                            <span className="sidebar-item__meta">
                                {otherUsers.length} 在线
                            </span>
                        </div>
                        <div className="sidebar-item__desc">公共聊天室...</div>
                    </div>
                </button>

                {/* AI 助手入口 */}
                <button
                    onClick={() => onSelectChat(AI_BOT_ID)}
                    className={`sidebar-item ${selectedChat === AI_BOT_ID ? "sidebar-item--active" : ""}`}
                >
                    <div className="avatar avatar--bot ai-avatar--img">
                        <img
                            src="/fmt.webp"
                            alt="AI"
                            className="ai-avatar-img"
                        />
                    </div>
                    <div className="sidebar-item__info">
                        <div className="sidebar-item__row">
                            <span className="sidebar-item__name">AI 助手</span>
                            <span className="sidebar-item__meta">就绪</span>
                        </div>
                        <div className="sidebar-item__desc">
                            DeepSeek AI 对话
                        </div>
                    </div>
                </button>

                {/* 分隔线 */}
                <div className="sidebar-divider">
                    <div className="sidebar-divider__line" />
                </div>

                {/* 在线用户列表：搜索无结果时显示空状态 */}
                {filteredUsers.length === 0 && searchQuery ? (
                    <div className="sidebar-empty animate-fade-in">
                        <div className="sidebar-empty__icon">
                            <Search size={20} />
                        </div>
                        <p className="sidebar-empty__text">没有找到联系人</p>
                    </div>
                ) : (
                    filteredUsers.map((user) => (
                        <button
                            key={user.user_id}
                            onClick={() => onSelectChat(user.user_id)}
                            className={`sidebar-item ${selectedChat === user.user_id ? "sidebar-item--active" : ""}`}
                        >
                            <div className="pos-relative">
                                {/* 头像颜色由昵称哈希确定，相同昵称始终显示相同颜色 */}
                                <div
                                    className={`avatar ${getAvatarColorClass(user.nickname)}`}
                                >
                                    {user.nickname.charAt(0).toUpperCase()}
                                </div>
                                <div className="online-dot" />
                            </div>
                            <div className="sidebar-item__info">
                                <div className="sidebar-item__row">
                                    <span className="sidebar-item__name">
                                        {user.nickname}
                                    </span>
                                </div>
                                <div className="sidebar-item__status">在线</div>
                            </div>
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
