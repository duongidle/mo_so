/** Cây danh mục phẳng hoá theo thứ tự hiển thị, mỗi mục kèm độ sâu: để vẽ cây thụt lề và ô chọn danh mục */
export function flattenTree(categories, { exclude } = {}) {
  const kids = new Map();
  for (const c of categories) {
    const k = c.parent_id && categories.some((x) => x.id === c.parent_id) ? c.parent_id : null;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(c);
  }
  const out = [];
  const walk = (parent, depth) => {
    for (const c of kids.get(parent) || []) {
      if (exclude && exclude.has(c.id)) continue;
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Danh mục và mọi con cháu của nó (để loại khỏi ô chọn cha, tránh vòng lặp) */
export function descendantIds(categories, id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) (ids.add(c.id), (grew = true));
  }
  return ids;
}

export const indent = (c) => `${'— '.repeat(c.depth)}${c.name}`;
