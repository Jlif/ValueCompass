import { useState } from 'react';

interface Props {
  // sw1 -> sw2 -> [sw3]
  tree: Record<string, Record<string, Set<string>>>;
  value: string; // '' | 'sw1:x' | 'sw2:x' | 'sw3:x'
  onChange: (v: string) => void;
}

// 行业树形下拉：点带子级的行 = 展开/收起（子级顶部有"全部 xx"可选中该层级）；
// 点无子级的行（三级）= 直接选中。箭头仅作展开指示。
export function IndustrySelect({ tree, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [exp1, setExp1] = useState<string | null>(null);
  const [exp2, setExp2] = useState<string | null>(null);

  const label = value ? value.split(':')[1] : '全部行业';
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="islt">
      <button className="islt-btn" onClick={() => setOpen(!open)}>
        {label}
        <span className="islt-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="islt-backdrop" onClick={() => setOpen(false)} />
          <div className="islt-panel">
            <div className={`islt-item ${value === '' ? 'islt-active' : ''}`} onClick={() => pick('')}>
              全部行业
            </div>
            {Object.entries(tree).sort().map(([sw1, l2map]) => (
              <div key={sw1}>
                <div
                  className={`islt-item islt-branch ${value === `sw1:${sw1}` ? 'islt-active' : ''}`}
                  onClick={() => { setExp1(exp1 === sw1 ? null : sw1); setExp2(null); }}
                >
                  <span className="islt-name">{sw1}</span>
                  <span className="islt-toggle">{exp1 === sw1 ? '▾' : '▸'}</span>
                </div>
                {exp1 === sw1 && (
                  <div className="islt-children">
                    <div
                      className={`islt-item islt-all ${value === `sw1:${sw1}` ? 'islt-active' : ''}`}
                      onClick={() => pick(`sw1:${sw1}`)}
                    >
                      全部 {sw1}
                    </div>
                    {Object.entries(l2map).sort().map(([sw2, sw3s]) => (
                      <div key={sw2}>
                        <div
                          className={`islt-item islt-branch ${value === `sw2:${sw2}` ? 'islt-active' : ''}`}
                          onClick={() => sw3s.size > 0 ? setExp2(exp2 === sw2 ? null : sw2) : pick(`sw2:${sw2}`)}
                        >
                          <span className="islt-name">{sw2}</span>
                          {sw3s.size > 0 && <span className="islt-toggle">{exp2 === sw2 ? '▾' : '▸'}</span>}
                        </div>
                        {exp2 === sw2 && (
                          <div className="islt-children">
                            <div
                              className={`islt-item islt-all ${value === `sw2:${sw2}` ? 'islt-active' : ''}`}
                              onClick={() => pick(`sw2:${sw2}`)}
                            >
                              全部 {sw2}
                            </div>
                            {[...sw3s].sort().map((sw3) => (
                              <div
                                key={sw3}
                                className={`islt-item islt-l3 ${value === `sw3:${sw3}` ? 'islt-active' : ''}`}
                                onClick={() => pick(`sw3:${sw3}`)}
                              >
                                {sw3}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
