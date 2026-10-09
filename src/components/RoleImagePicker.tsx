import { Button, Empty, Modal } from "@arco-design/web-react";
import { imageUrl, type Media, type Role } from "../core";

export function RoleImagePicker({ visible, title, roles, selectedIds, onSelect, onClose, multiple = false, disabled = false, showPrimary = true }: {
  visible: boolean;
  title: string;
  roles: Role[];
  selectedIds: number[];
  onSelect: (media: Media) => void;
  onClose: () => void;
  multiple?: boolean;
  disabled?: boolean;
  showPrimary?: boolean;
}) {
  return <Modal title={title} visible={visible} onCancel={onClose}
    footer={multiple ? <Button type="primary" onClick={onClose}>完成</Button> : null}>
    <div className="role-image-groups">
      {roles.map(role => <div key={role.id}>
        <b>{role.name}</b>
        <div className="media-picker">{role.images.map(media => <button type="button" key={media.id}
          className={`media-option${selectedIds.includes(media.id) ? " selected" : ""}`} disabled={disabled}
          aria-pressed={selectedIds.includes(media.id)} aria-label={`选择角色图片 ${role.name} · ${media.name}`} onClick={() => onSelect(media)}>
          <img src={imageUrl(media)} alt="" />
          <span>{showPrimary && media.id === role.design_media_id ? `主图 · ${media.name}` : media.name}</span>
        </button>)}</div>
        {!role.images.length && <p className="subtle">该角色还没有图片</p>}
      </div>)}
      {!roles.some(role => role.images.length) && <Empty description="角色中还没有图片" />}
    </div>
  </Modal>;
}
