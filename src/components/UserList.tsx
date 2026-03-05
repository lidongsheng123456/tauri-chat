import { Globe, MessageSquare, Search, Users } from "lucide-react";
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

const AVATAR_COLORS = [
  "bg-rose-500/20 text-rose-300",
  "bg-violet-500/20 text-violet-300",
  "bg-sky-500/20 text-sky-300",
  "bg-amber-500/20 text-amber-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-pink-500/20 text-pink-300",
  "bg-indigo-500/20 text-indigo-300",
  "bg-teal-500/20 text-teal-300",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function UserList({ users, myUserId, selectedChat, onSelectChat, connected, serverIp }: UserListProps) {
  const otherUsers = users.filter((u) => u.user_id !== myUserId);
  const [searchQuery, setSearchQuery] = useState("");
  const filteredUsers = searchQuery
    ? otherUsers.filter((u) => u.nickname.toLowerCase().includes(searchQuery.toLowerCase()))
    : otherUsers;

  return (
    <div className="w-[300px] shrink-0 bg-sidebar flex flex-col h-full select-none border-r border-white/8">
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-white">消息</h2>
          <span className="text-xs bg-accent/15 text-accent px-2.5 py-1 rounded-full font-medium tabular-nums">
            {users.length} 在线
          </span>
        </div>
        {/* Connection info */}
        <div className="flex items-center gap-2 text-xs text-sidebar-muted">
          <Globe className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono truncate">{serverIp}:9120</span>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-success animate-pulse-dot" : "bg-danger"}`} />
            <span>{connected ? "已连接" : "断开"}</span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sidebar-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索联系人..."
            className="w-full pl-10 pr-3 py-2.5 bg-white/8 border border-white/6 rounded-xl text-sm text-sidebar-text placeholder-sidebar-muted/50 focus:bg-white/10 focus:border-accent/30 outline-none transition-all duration-200"
          />
        </div>
      </div>

      {/* Section: Channel */}
      <div className="px-5 pt-1 pb-2">
        <span className="text-[11px] font-semibold text-sidebar-muted uppercase tracking-wider">频道</span>
      </div>

      {/* Group Chat */}
      <div className="px-3">
        <button
          onClick={() => onSelectChat("all")}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer group ${selectedChat === "all"
            ? "bg-accent/15 text-white"
            : "text-sidebar-text hover:bg-sidebar-hover"
            }`}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${selectedChat === "all" ? "bg-accent/25" : "bg-white/8 group-hover:bg-white/10"
            }`}>
            <MessageSquare className={`w-5 h-5 ${selectedChat === "all" ? "text-accent" : "text-sidebar-muted"}`} />
          </div>
          <div className="text-left min-w-0 flex-1">
            <div className="font-medium text-sm">群聊</div>
            <div className="text-xs text-sidebar-muted mt-0.5">{users.length} 位成员</div>
          </div>
        </button>
      </div>

      {/* Section: Private */}
      <div className="px-5 pt-5 pb-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-sidebar-muted uppercase tracking-wider">私聊</span>
          <span className="text-[11px] text-sidebar-muted/60 tabular-nums">{otherUsers.length}</span>
        </div>
      </div>

      {/* User List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {filteredUsers.length === 0 ? (
          <div className="text-center mt-12 px-6 animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-3">
              <Users className="w-7 h-7 text-sidebar-muted/40" />
            </div>
            <p className="text-sidebar-muted text-sm">
              {searchQuery ? "未找到匹配的用户" : "等待其他用户加入..."}
            </p>
          </div>
        ) : (
          filteredUsers.map((user) => (
            <button
              key={user.user_id}
              onClick={() => onSelectChat(user.user_id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 mb-0.5 cursor-pointer group ${selectedChat === user.user_id
                ? "bg-accent/15 text-white"
                : "text-sidebar-text hover:bg-sidebar-hover"
                }`}
            >
              <div className="relative shrink-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${selectedChat === user.user_id
                  ? "bg-accent/25 text-accent"
                  : getAvatarColor(user.nickname)
                  }`}>
                  {user.nickname.charAt(0).toUpperCase()}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-success border-2 border-sidebar" />
              </div>
              <div className="text-left min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{user.nickname}</div>
                <div className="text-xs text-sidebar-muted mt-0.5">在线</div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
