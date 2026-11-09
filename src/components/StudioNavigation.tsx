import { Button, Layout, Menu } from "@arco-design/web-react";
import {
  Bot, Boxes, ChevronRight, Clapperboard, Film, FolderOpen, ImagePlus, LayoutDashboard,
  PanelLeftClose, PanelLeftOpen, Plus, Settings, WandSparkles, X,
} from "lucide-react";
import type { KeyboardEvent } from "react";

export const studioNavigationId = "studio-navigation";

const workspacePages = [
  { id: "agent", label: "Agent 助手", icon: Bot },
  { id: "studio", label: "工作台", icon: LayoutDashboard },
  { id: "episodes", label: "剧集", icon: Clapperboard },
  { id: "editor", label: "音视频剪辑", icon: Film },
  { id: "assets", label: "素材库", icon: ImagePlus },
  { id: "roles", label: "资产库", icon: Boxes },
  { id: "project-config", label: "项目配置", icon: Settings },
  { id: "tasks", label: "后台任务", icon: Film },
  { id: "prompts", label: "Prompt 库", icon: WandSparkles },
];

type StudioNavigationProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  page: string;
  projectName: string;
  onToggle: () => void;
  onCloseMobile: () => void;
  onNavigate: (page: string) => void;
  onOpenProject: () => void;
  onCreateProject: () => void;
};

export function StudioNavigation({
  collapsed, mobileOpen, page, projectName, onToggle, onCloseMobile, onNavigate,
  onOpenProject, onCreateProject,
}: StudioNavigationProps) {
  const toggleLabel = collapsed ? "展开导航" : "收起导航";
  const projectLabel = `切换项目：${projectName}`;
  const handleDrawerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCloseMobile();
    }
    if (event.key === "Tab") {
      const first = event.currentTarget.querySelector<HTMLButtonElement>(".mobile-nav-close");
      const last = event.currentTarget.querySelector<HTMLButtonElement>(".side-bottom button");
      const [from, to] = event.shiftKey ? [first, last] : [last, first];
      if (document.activeElement === from) {
        event.preventDefault();
        to?.focus();
      }
    }
  };

  return (
    <Layout.Sider className={`side${collapsed ? " side-collapsed" : ""}`}>
      <div className="side-navigation-body" role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen || undefined} aria-label={mobileOpen ? "工作室导航" : undefined}
        onKeyDown={mobileOpen ? handleDrawerKey : undefined}>
        <div className="side-header">
          <Button className="sidebar-toggle desktop-sidebar-toggle" type="text"
            title={toggleLabel} aria-label={toggleLabel} aria-controls={studioNavigationId}
            aria-expanded={!collapsed} icon={collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            onClick={onToggle} />
          <div className="logo">
            <img className="logo-mark" src="/spielberg-logo-s.png" alt="" />
            <div><b>Spielberg</b><small>漫剧制作工作室</small></div>
          </div>
          <Button className="sidebar-toggle mobile-nav-close" type="text" title="关闭导航"
            aria-label="关闭导航" icon={<X size={18} />} onClick={onCloseMobile} />
        </div>
        <nav id={studioNavigationId} className="side-navigation-links" aria-label="工作室导航">
          <button type="button" title={projectLabel} aria-label={projectLabel}
            aria-current={page === "projects" ? "page" : undefined} className="project-switch" onClick={() => onNavigate("projects")}>
            <FolderOpen size={17} aria-hidden="true" />
            <div><strong>{projectName}</strong></div>
            <ChevronRight size={15} className="project-chevron" aria-hidden="true" />
          </button>
          <div className="nav-label">制作空间</div>
          <Menu selectedKeys={[page]} onClickMenuItem={key => onNavigate(key)} className="nav">
            {workspacePages.map(({ id, label, icon: Icon }) => (
              <Menu.Item key={id} title={label} aria-label={label} aria-current={page === id ? "page" : undefined}>
                <Icon aria-hidden="true" /><span className="nav-item-label">{label}</span>
              </Menu.Item>
            ))}
          </Menu>
          <div className="mobile-project-actions">
            <Button icon={<FolderOpen size={16} />} onClick={onOpenProject}>打开项目</Button>
            <Button icon={<Plus size={16} />} onClick={onCreateProject}>新建项目</Button>
          </div>
          <div className="side-bottom">
            <Button type="text" long data-active={page === "settings"} title="设置" aria-label="设置"
              aria-current={page === "settings" ? "page" : undefined} icon={<Settings size={18} />}
              onClick={() => onNavigate("settings")}>
              <span>设置</span>
            </Button>
          </div>
        </nav>
      </div>
    </Layout.Sider>
  );
}
