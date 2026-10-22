import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Stock, WatchGroup } from '../types';
import { stockKey } from '../utils/stockKey';

interface Props {
  stock: Stock;
  groups: WatchGroup[];
  inWatchlist: boolean;
  addToWatchlist: (stock: Stock) => void;
  addToGroup: (id: string, code: string) => void;
}

// 股票行右侧「加入分组」菜单：悬停「添加到分组」向右展开分组清单
export function StockGroupMenu({ stock, groups, inWatchlist, addToWatchlist, addToGroup }: Props) {
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // fixed 定位按按钮位置展开，避免被 stock-list 的 overflow 裁剪
  const openMenu = () => {
    const r = btnRef.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen(true);
  };

  // 点击菜单外任意位置关闭（同 SyncPanel）；菜单 portal 到 body，两个 ref 都要认
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (gid: string) => {
    // 「全部」tab 里的股票不一定在自选中，分组是自选的子集，先补进自选
    if (!inWatchlist) addToWatchlist(stock);
    addToGroup(gid, stockKey(stock));
    setOpen(false);
  };

  return (
    // 拦住点击冒泡，避免触发行选中/K线加载
    <div className="sgm-wrap" ref={wrapRef} onClick={(e) => e.stopPropagation()}>
      <button ref={btnRef} className="sgm-btn" title="加入分组" onClick={() => (open ? setOpen(false) : openMenu())}>
        ⋯
      </button>
      {open &&
        pos &&
        // portal 到 body：行 :hover 的 transform 会把 fixed 菜单变回相对行定位，必须挂出去
        createPortal(
          <div ref={menuRef} className="sgm-menu" style={{ top: pos.top, right: pos.right }}>
            <div className="sgm-item" onMouseEnter={() => setSubOpen(true)} onClick={() => setSubOpen(!subOpen)}>
              添加到分组 <span className="sgm-arrow">▸</span>
              {subOpen && (
                <div className="sgm-sub">
                  {groups.length === 0 && <div className="sgm-empty">暂无分组，先在自选栏新建</div>}
                  {groups.map((g) => (
                    <button key={g.id} className="sgm-group" onClick={() => pick(g.id)}>
                      <span className="sgm-check">{g.codes.includes(stockKey(stock)) ? '✓' : ''}</span>
                      {g.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
