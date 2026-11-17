import { capacity, GameConfig, holeCardCount, normalizeGame, Structure, VARIANT_ORDER, VARIANTS, VariantId } from '../../shared/variants';
import { cls } from '../lib/format';

export const VARIANT_ICON: Record<VariantId, string> = {
  holdem: '♠️',
  omaha: '🔥',
  irish: '☘️',
  pineapple: '🍍',
  crazypineapple: '🤪',
  shortdeck: '6️⃣',
  teenpatti: '🪔',
  muflis: '🙃',
};

const STRUCT_NAME: Record<Structure, string> = { NL: 'No-Limit', PL: 'Pot-Limit', FL: 'Limit' };

export function GamePicker({ value, onChange, players = 0 }: { value: GameConfig; onChange: (g: GameConfig) => void; players?: number }) {
  const cfg = normalizeGame(value);
  const info = VARIANTS[cfg.variant];
  const set = (patch: Partial<GameConfig>) => onChange(normalizeGame({ ...cfg, ...patch }));
  const pick = (v: VariantId) => {
    if (v === cfg.variant) return;
    onChange(normalizeGame({ ...cfg, variant: v, structure: VARIANTS[v].defaultStructure }));
  };
  const cap = capacity(cfg);
  const tooMany = players > cap;

  return (
    <div className="field" style={{ gap: 14 }}>
      <div className="game-grid">
        {VARIANT_ORDER.map((id) => {
          const v = VARIANTS[id];
          const c = capacity(normalizeGame({ variant: id }));
          const disabled = players > c;
          return (
            <button key={id} className={cls('game-tile', cfg.variant === id && 'on', disabled && 'disabled')} onClick={() => pick(id)} type="button">
              <span className="gt-icon">{VARIANT_ICON[id]}</span>
              <span className="gt-name">{v.name}</span>
              <span className="gt-sub">
                {id === 'omaha' ? '4/5/6 cards' : `${v.baseHoleCards} cards`}
                {v.discard ? ` · discard ${v.discard.count}` : ''}
              </span>
            </button>
          );
        })}
      </div>
      <p className="blurb">{info.blurb}</p>

      {info.structures.length > 1 && (
        <div className="field">
          <label>Betting</label>
          <div className="seg">
            {info.structures.map((s) => (
              <button key={s} type="button" className={cls(cfg.structure === s && 'on')} onClick={() => set({ structure: s })}>
                {STRUCT_NAME[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      {info.allowOmahaCards && (
        <div className="field">
          <label>Hole cards</label>
          <div className="seg">
            {([4, 5, 6] as const).map((n) => (
              <button key={n} type="button" className={cls(cfg.omahaCards === n && 'on')} onClick={() => set({ omahaCards: n })}>
                {n} cards{n === 4 ? '' : n === 5 ? ' (PLO5)' : ' (PLO6)'}
              </button>
            ))}
          </div>
        </div>
      )}

      {info.allowHiLo && (
        <div className="setting-row">
          <div className="sr-text">
            <b>Hi-Lo split pot</b>
            <span>Best high and best 8-or-better low share the pot</span>
          </div>
          <button type="button" className={cls('toggle', cfg.hiLo && 'on')} onClick={() => set({ hiLo: !cfg.hiLo })} aria-pressed={cfg.hiLo} />
        </div>
      )}

      {info.allowBoards && (
        <div className="field">
          <label>Boards (pot split between boards)</label>
          <div className="seg">
            {([1, 2, 3] as const)
              .filter((b) => !(cfg.variant === 'shortdeck' && b === 3))
              .map((b) => (
                <button key={b} type="button" className={cls(cfg.boards === b && 'on')} onClick={() => set({ boards: b })}>
                  {b === 1 ? 'Single' : b === 2 ? 'Double' : 'Triple'}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className={cls('muted')} style={{ fontSize: 12.5, color: tooMany ? 'var(--red)' : undefined }}>
        {holeCardCount(cfg)} hole cards · up to {cap} players{tooMany ? ` — ${players} are seated, pick another option` : ''}
      </div>
    </div>
  );
}
