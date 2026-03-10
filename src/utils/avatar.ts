/**
 * avatar.ts — 头像工具函数
 *
 * 根据用户昵称生成确定性的头像颜色类名，
 * 颜色由昵称哈希值决定，相同昵称始终对应相同颜色。
 */

/** 头像颜色总数（对应 base.css 中 .avatar-color-0 ~ .avatar-color-6） */
const AVATAR_COLOR_COUNT = 7;

/**
 * 根据昵称生成头像颜色类名。
 *
 * 使用简单的多项式哈希算法，将任意昵称映射到
 * `avatar-color-0` ~ `avatar-color-6` 之一。
 *
 * @param name - 用户昵称
 * @returns CSS 类名，如 `"avatar-color-3"`
 */
export function getAvatarColorClass(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `avatar-color-${Math.abs(hash) % AVATAR_COLOR_COUNT}`;
}
