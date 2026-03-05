import { Search, Users } from "lucide-react";
import { useState } from "react";
import type { UserInfo } from "../types";

interface UserListProps {
  users: UserInfo[];
  myUserId: string;
  selectedChat: string;
  onSelectChat: (userId: string) => void;
  connected: boolean;
  serverIp: string;
}

const AVATAR_COLOR_COUNT = 7;

function getAvatarColorClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `avatar-color-${Math.abs(hash) % AVATAR_COLOR_COUNT}`;
}

export function UserList({ users, myUserId, selectedChat, onSelectChat, connected, serverIp }: UserListProps) {
  const otherUsers = users.filter((u) => u.user_id !== myUserId);
  const [searchQuery, setSearchQuery] = useState("");
  const filteredUsers = searchQuery
    ? otherUsers.filter((u) => u.nickname.toLowerCase().includes(searchQuery.toLowerCase()))
    : otherUsers;

  return (
    <div className="sidebar">
      {/* Header & Search */}
      <div className="sidebar-header">
        <div className="sidebar-header__top">
          <h2 className="sidebar-title">消息</h2>
          <div className="sidebar-status">
            <span className={`sidebar-status__dot ${connected ? "sidebar-status__dot--online" : "sidebar-status__dot--offline"}`} />
            <span className="sidebar-status__text">{connected ? "已连接" : "断开"}</span>
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

      {/* Network Info */}
      <div className="sidebar-server-info">
        Server: {serverIp}:9120
      </div>

      {/* User List */}
      <div className="sidebar-list">
        <div className="sidebar-list__spacer" />

        {/* Group Chat */}
        <button
          onClick={() => onSelectChat("all")}
          className={`sidebar-item ${selectedChat === "all" ? "sidebar-item--active" : ""}`}
        >
          <div className="avatar avatar--group">
            <Users size={20} />
          </div>
          <div className="sidebar-item__info">
            <div className="sidebar-item__row">
              <span className="sidebar-item__name">所有人频道</span>
              <span className="sidebar-item__meta">{users.length} 在线</span>
            </div>
            <div className="sidebar-item__desc">公共聊天室...</div>
          </div>
        </button>

        {/* Divider */}
        <div className="sidebar-divider">
          <div className="sidebar-divider__line" />
        </div>

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
                <div className={`avatar ${getAvatarColorClass(user.nickname)}`}>
                  {user.nickname.charAt(0).toUpperCase()}
                </div>
                <div className="online-dot" />
              </div>
              <div className="sidebar-item__info">
                <div className="sidebar-item__row">
                  <span className="sidebar-item__name">{user.nickname}</span>
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
