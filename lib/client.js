// DSH 客户端入口：在侧栏注册「会话管理」面板入口，主区域用 iframe 加载 /swm 面板页。
// 挂载模式与官方 @deepseek-ai/dsh-client-ui-schedule 一致：经宿主模块加载器注入 slots。
const PANEL_ID = 'dsh-session-ws-manager-panel';

if (typeof window !== 'undefined' && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
  window.__ModuleLoader__.load({
    id: 'dsh-session-ws-manager',
    factory: (require) => {
      let React = null;
      try {
        React = require('react');
      } catch {
        React = null;
      }
      const h = React && React.createElement ? React.createElement : null;

      // 侧栏图标（尽量零依赖：React 可用时用元素，否则用文本占位）
      function PanelIcon() {
        if (h) return h('span', { style: { fontSize: 16 } }, '🗂');
        return null;
      }
      // 主区域页面：整页 iframe 指向宿主 webServer 上的 /swm 面板
      function PanelPage() {
        if (h) {
          return h('div', {
            style: { width: '100%', height: '100%', overflow: 'hidden' },
          }, h('iframe', {
            src: '/swm',
            title: '会话工作区管理',
            style: { width: '100%', height: '100%', border: '0', display: 'block', background: 'transparent' },
          }));
        }
        return null;
      }

      return {
        inject: ['slots'],
        apply(ctx) {
          const registerPanel = () => {
            try {
              ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 30,
                label: () => '会话管理',
              }, PanelIcon));
              ctx.slots.inject('main', () => ctx.slots.register({
                name: 'main',
                key: PANEL_ID,
                inject: () => ({}),
              }, PanelPage));
            } catch (e) {
              console.error('[swm] 面板槽位注册失败:', e);
            }
          };
          if (typeof ctx.effect === 'function') ctx.effect(registerPanel);
          else registerPanel();
        },
      };
    },
  });
} else {
  console.warn('[swm] 未找到 window.__ModuleLoader__，侧栏面板未挂载（可直接访问 /swm 使用）');
}
