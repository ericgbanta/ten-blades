import { describe, expect, it } from 'vitest';
import { applyAction, createBattle, planUnitAction, runAiPhase, type AiState, type BattleState, type PartyUnit } from '../src/core';
import { campContent, chapters, gameData } from '../src/data';
import { deployInfo, equip, fromConvoy, isWounded, reorder, scalingShift, setBenched, toConvoy } from '../src/camp/barracks';
import { campBackdrop, facilityOpen, facilityOpensText, leaveCamp, readTalk, routeNodes, skirmishList, startableChapter, talkList } from '../src/camp/camp';
import type { CampCtx } from '../src/camp/ctx';
import { awaken, awakenBlock, bladeViews, forgeWeapon, UNBOUND_FLAG, unboundCount, upgradeBlock, upgradeCost } from '../src/camp/forge';
import { applyRewards, battleRewards } from '../src/camp/rewards';
import { buy, buyPrice, sell, sellPrice, shopStock } from '../src/camp/shop';
import { applyPermadeath, battleSetup, completeChapter, completeSkirmish } from '../src/save/campaign';
import type { CampaignSave } from '../src/save/format';
import { validateCampaign } from '../src/save/validate';
import { flowStep, settle } from '../src/story/flow';
import v5 from './fixtures/save-v5.json';

const ctx: CampCtx = { data: gameData, chapters, camp: campContent };
const camp = (): CampaignSave => structuredClone(v5) as unknown as CampaignSave;
const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const why = (r: { ok: boolean; error?: string }): string => (r.ok ? 'ok' : r.error!);

const recruit = (id: string, classId: string, level: number, weaponId: string): PartyUnit => ({
  id,
  name: id,
  classId,
  level,
  xp: 0,
  stats: { ...gameData.classes[classId]!.baseStats },
  weaponId,
  isLord: false,
  inventory: [weaponId],
});

/** The fixture with four more units, so deployment has choices. */
function bigParty(): CampaignSave {
  const c = camp();
  c.party.push(
    recruit('ana', 'soldier', 3, 'iron_lance'),
    recruit('bo', 'ranger', 2, 'short_bow'),
    recruit('cy', 'adept', 4, 'ember_tome'),
    recruit('di', 'medic', 1, 'mending_rod'),
  );
  return c;
}

const PLAYER_AI: AiState = { behavior: 'charge', guardTile: null, guardRadius: 0, active: false };

/** Play a battle to the end, charge AI on both sides. */
function autoplay(s0: BattleState): BattleState {
  let s = s0;
  for (let t = 0; t < 40 && s.result === 'ongoing'; t++) {
    for (;;) {
      const next = s.units.find((u) => u.alive && u.team === 'player' && !u.acted);
      if (!next || s.result !== 'ongoing') break;
      s = applyAction(s, planUnitAction(s, next.id, gameData, PLAYER_AI), gameData).state;
    }
    if (s.result !== 'ongoing') break;
    s = runAiPhase(applyAction(s, { type: 'endPhase' }, gameData).state, gameData).state;
  }
  return s;
}

describe('rewards', () => {
  const won = (patch: (s: BattleState) => void): BattleState => {
    const s = createBattle(gameData.maps.prologue!, { difficulty: 'normal', permadeath: 'classic', mc: { name: 'A', style: 'vanguard' } }, 1, gameData);
    s.result = 'victory';
    for (const u of s.units) if (u.team === 'enemy') u.alive = false;
    patch(s);
    return s;
  };
  const def = campContent.economy.rewards.prologue!;

  it('pays the map, each bonus met, and the drops of fallen enemies', () => {
    const r = battleRewards(
      won((s) => (s.turn = 4)),
      def,
    );
    expect(r.bonuses.map((b) => [b.id, b.met])).toEqual([
      ['swift', true],
      ['none_lost', true],
    ]);
    expect(r).toMatchObject({ gold: 500 + 200, shards: 1 + 1, items: ['healing_salve'], baseGold: 500, baseShards: 1 });
  });

  it('misses the turn bonus when slow and the no-loss bonus when someone fell', () => {
    const r = battleRewards(
      won((s) => {
        s.turn = 6;
        s.units.find((u) => u.id === 'stranger')!.alive = false;
      }),
      def,
    );
    expect(r.bonuses.every((b) => !b.met)).toBe(true);
    expect(r.gold).toBe(500);
    expect(r.shards).toBe(1);
  });

  it('pays nothing for a lost battle and adds what was won to the campaign', () => {
    const lost = won((s) => (s.result = 'defeat'));
    expect(battleRewards(lost, def).gold).toBe(0);
    const c = applyRewards(
      camp(),
      battleRewards(
        won((s) => (s.turn = 2)),
        def,
      ),
      campContent.economy,
    );
    expect(c.gold).toBe(1250 + 700);
    expect(c.shards).toBe(3 + 2);
    expect(c.convoy.at(-1)).toBe('healing_salve');
  });

  it('a won prologue (completeChapter with the economy) pays out into the save', () => {
    const c0 = { ...camp(), party: [], gold: 0, shards: 0, convoy: [], progress: { current: 'prologue', completed: [], stage: 'battle' as const, scenes: [] } };
    const s = autoplay(createBattle(gameData.maps.prologue!, battleSetup(c0), 1001, gameData));
    expect(s.result).toBe('victory');
    const next = completeChapter(c0, s, chapters, 5, campContent.economy);
    expect(next.gold).toBe(battleRewards(s, def).gold);
    expect(next.gold).toBeGreaterThanOrEqual(500);
    expect(validateCampaign(next, { data: gameData, chapters }).ok).toBe(true);
  });
});

describe('the merchant', () => {
  it('stocks by chapter, prices from the data, sells at half', () => {
    expect(shopStock(camp(), ctx).items).toEqual(['healing_salve', 'mender_tonic', 'grave_wine']);
    expect(buyPrice('iron_lance', ctx)).toBe(450);
    expect(buyPrice('iron_katana+1', ctx)).toBe(650 + 300);
    expect(sellPrice('iron_lance', ctx)).toBe(225);
    expect(sellPrice('iron_katana+1', ctx)).toBe(475);
    expect(sellPrice('widows_hush_duelist', ctx)).toBeNull();
    expect(buyPrice('gravemaw', ctx)).toBeNull();
  });

  it('buys into a unit or the convoy, and cannot overspend or overfill', () => {
    const c = ok(buy(camp(), 'healing_salve', { unitId: 'mc' }, ctx));
    expect(c.gold).toBe(1250 - 150);
    expect(c.party[0]!.inventory).toEqual(['widows_hush_duelist', 'iron_katana+1', 'healing_salve', 'healing_salve']);
    const c2 = ok(buy(c, 'iron_katana', { convoy: true }, ctx));
    expect(c2.convoy.at(-1)).toBe('iron_katana');
    expect(c2.gold).toBe(1250 - 150 - 650);
    expect(why(buy({ ...c2, gold: 100 }, 'healing_salve', { convoy: true }, ctx))).toBe('Not enough gold: 150 needed, 100 held');
    const full = ok(buy(c, 'healing_salve', { unitId: 'mc' }, ctx));
    expect(why(buy(full, 'healing_salve', { unitId: 'mc' }, ctx))).toMatch(/no free slot/);
    expect(why(buy(camp(), 'iron_greatsword', { convoy: true }, ctx))).toMatch(/not for sale here/);
  });

  it('sells from a unit or the convoy, never a blade or the weapon in hand', () => {
    const c = ok(sell(camp(), { unitId: 'mc' }, 2, ctx));
    expect(c.gold).toBe(1250 + 75);
    expect(c.party[0]!.inventory).toEqual(['widows_hush_duelist', 'iron_katana+1']);
    expect(why(sell(camp(), { unitId: 'mc' }, 0, ctx))).toMatch(/cannot be sold/);
    const armed = ok(equip(camp(), 'mc', 1, ctx));
    expect(why(sell(armed, { unitId: 'mc' }, 1, ctx))).toMatch(/in hand/);
    const fromConv = ok(sell(camp(), { convoy: true }, 0, ctx));
    expect(fromConv.convoy).toEqual(['mender_tonic']);
    expect(fromConv.gold).toBe(1250 + 200);
  });
});

describe('the forge: awakening', () => {
  it('shows each blade: tier, powers, what the next tier costs and needs', () => {
    const [view] = bladeViews(camp(), ctx);
    expect(view).toMatchObject({ bladeId: 'widows_hush', tier: 1, tierName: 'Dormant', bearer: { id: 'mc' } });
    expect(view!.powers.map((p) => p.id)).toEqual(['echo']);
    expect(view!.next).toMatchObject({ shards: 3, requirement: 'Reach Chapter 1', met: true, block: null, def: { tier: 2, power: 'hush' } });
  });

  it('awakens to tier 2: spends shards, raises the tier, boosts the bearer once, adds Hush', () => {
    const before = camp();
    const c = ok(awaken(before, 'widows_hush', ctx));
    expect(c.shards).toBe(0);
    expect(c.blades.widows_hush).toEqual({ tier: 2 });
    const s0 = before.party[0]!.stats;
    expect(c.party[0]!.stats).toEqual({ ...s0, skl: s0.skl + 2, spd: s0.spd + 1, lck: s0.lck + 1 });
    expect(bladeViews(c, ctx)[0]!.powers.map((p) => p.id)).toEqual(['echo', 'hush']);
    // The battle gets the tier: the bearer has both powers and pays the price.
    expect(battleSetup(c).bladeTiers).toEqual({ widows_hush: 2 });
    expect(validateCampaign(c, { data: gameData, chapters }).ok).toBe(true);
  });

  it('needs the shards and the story condition; tier 3 waits for Act 3', () => {
    expect(awakenBlock({ ...camp(), shards: 2 }, 'widows_hush', ctx)).toBe('Needs 3 Blade Shards (you have 2)');
    const t2 = ok(awaken(camp(), 'widows_hush', ctx));
    expect(awakenBlock({ ...t2, shards: 99 }, 'widows_hush', ctx)).toBe('Reach Act 3');
    expect(bladeViews(t2, ctx)[0]!.next).toMatchObject({ requirement: 'Reach Act 3', met: false });
    const early = { ...camp(), progress: { ...camp().progress, current: 'prologue', completed: [] } };
    expect(awakenBlock(early, 'widows_hush', ctx)).toBe('Reach Chapter 1');
    expect(awakenBlock(camp(), 'gravemaw', ctx)).toBe('The party does not hold that blade');
  });

  it('reaching the last tier counts an Unbound blade in the story flags (the endings hook)', () => {
    const data = structuredClone(gameData);
    delete data.blades.widows_hush!.tiers[2]!.requires!.act;
    const easy: CampCtx = { ...ctx, data };
    const t3 = ok(awaken({ ...ok(awaken(camp(), 'widows_hush', easy)), shards: 8 }, 'widows_hush', easy));
    expect(t3.blades.widows_hush!.tier).toBe(3);
    expect(t3.flags[UNBOUND_FLAG]).toBe(1);
    expect(unboundCount(t3, easy)).toBe(1);
    expect(awakenBlock(t3, 'widows_hush', easy)).toMatch(/last tier/);
  });
});

describe('the forge: weapon upgrades', () => {
  it('raises a generic weapon a rank for gold, up to the cap; blades are never forged with gold', () => {
    expect(upgradeCost('iron_katana', ctx)).toBe(300);
    expect(upgradeCost('iron_katana+1', ctx)).toBe(600);
    expect(upgradeCost('iron_katana+2', ctx)).toBeNull();
    expect(upgradeBlock('widows_hush_duelist', 9999, ctx)).toMatch(/shards, not gold/);
    const c = ok(forgeWeapon(camp(), { unitId: 'mc' }, 1, ctx));
    expect(c.party[0]!.inventory[1]).toBe('iron_katana+2');
    expect(c.gold).toBe(1250 - 600);
    expect(why(forgeWeapon(c, { unitId: 'mc' }, 1, ctx))).toMatch(/at its best/);
    expect(why(forgeWeapon({ ...camp(), gold: 10 }, { convoy: true }, 0, ctx))).toBe('Needs 300 gold (you have 10)');
    const conv = ok(forgeWeapon(camp(), { convoy: true }, 0, ctx));
    expect(conv.convoy[0]).toBe('hunting_knife+1');
  });

  it('a forged weapon in hand stays in hand', () => {
    const armed = ok(equip(camp(), 'mc', 1, ctx));
    const c = ok(forgeWeapon(armed, { unitId: 'mc' }, 1, ctx));
    expect(c.party[0]!.weaponId).toBe('iron_katana+2');
  });
});

describe('the barracks', () => {
  it('equips, gives to and takes from the convoy; a blade stays with its bearer', () => {
    const c = ok(equip(camp(), 'mc', 1, ctx));
    expect(c.party[0]!.weaponId).toBe('iron_katana+1');
    expect(why(equip(c, 'mc', 2, ctx))).toMatch(/not a weapon/);
    expect(why(toConvoy(c, 'mc', 0, ctx))).toMatch(/will not leave/);
    const given = ok(toConvoy(c, 'mc', 1, ctx));
    // Giving up the weapon in hand equips the next one the unit can wield.
    expect(given.party[0]).toMatchObject({ weaponId: 'widows_hush_duelist', inventory: ['widows_hush_duelist', 'healing_salve'] });
    expect(given.convoy).toEqual(['hunting_knife', 'mender_tonic', 'iron_katana+1']);
    const taken = ok(fromConvoy(given, 0, 'mc', ctx));
    expect(taken.party[0]!.inventory).toEqual(['widows_hush_duelist', 'healing_salve', 'hunting_knife']);
    expect(taken.convoy).toEqual(['mender_tonic', 'iron_katana+1']);
    expect(validateCampaign(taken, { data: gameData, chapters }).ok).toBe(true);
  });

  it('reorders the roster and benches anyone but the main character', () => {
    const c = ok(reorder(bigParty(), 'cy', -2));
    expect(c.party.map((u) => u.id)).toEqual(['mc', 'cy', 'ana', 'bo', 'di']);
    expect(why(setBenched(c, 'mc', true, ctx, 'ridge'))).toMatch(/must deploy/);
    expect(ok(setBenched(c, 'ana', true, ctx, 'ridge')).benched).toEqual(['ana']);
  });

  it("deploys the main character, then the roster in order up to the map's limit; the bench and the wounded stay", () => {
    let c = bigParty();
    let info = deployInfo(c, ctx, 'ridge')!;
    expect(info.max).toBe(4);
    expect(info.units.map((u) => [u.unit.id, u.status])).toEqual([
      ['mc', 'deploy'],
      ['ana', 'deploy'],
      ['bo', 'deploy'],
      ['cy', 'deploy'],
      ['di', 'full'],
    ]);
    c = ok(setBenched(c, 'bo', true, ctx, 'ridge'));
    c = { ...c, wounded: { ana: 1 } };
    info = deployInfo(c, ctx, 'ridge')!;
    expect(info.deployed.map((u) => u.id)).toEqual(['mc', 'cy', 'di']);
    expect(info.units.find((u) => u.unit.id === 'ana')!.status).toBe('wounded');
    expect(isWounded(c, 'ana', ctx)).toBe(true);
    // The battle takes exactly the deployed units in that order.
    const s = createBattle(gameData.maps.skirmish_ridge!, battleSetup(c, { party: info.deployed, enemyLevelShift: info.enemyLevelShift }), 1, gameData);
    expect(s.units.filter((u) => u.team === 'player').map((u) => u.id)).toEqual(['mc', 'cy', 'di', 'warden_1', 'warden_2']);
    // No map for chapter 1 yet: no story deployment.
    expect(deployInfo(c, ctx, null)).toBeNull();
  });
});

describe('skirmishes', () => {
  it("scale enemies to the deployed party's average level, clamped", () => {
    const s = { baseLevel: 1, offset: 0, min: 1, max: 20 };
    expect(scalingShift([recruit('a', 'soldier', 2, 'iron_lance'), recruit('b', 'soldier', 5, 'iron_lance')], s)).toBe(3);
    expect(scalingShift([recruit('a', 'soldier', 1, 'iron_lance')], s)).toBe(0);
    expect(scalingShift([recruit('a', 'soldier', 30, 'iron_lance')], { ...s, max: 10 })).toBe(9);
    const info = deployInfo(bigParty(), ctx, 'ridge')!;
    const shift = info.enemyLevelShift;
    // Average level 3, the offset -1, the map's base level 1.
    expect(shift).toBe(Math.round((2 + 3 + 2 + 4) / 4) - 1 - 1);
    const b = createBattle(gameData.maps.skirmish_ridge!, battleSetup(bigParty(), { party: info.deployed, enemyLevelShift: shift }), 1, gameData);
    expect(b.units.find((u) => u.id === 'deserter_6')!.level).toBe(2 + shift);
  });

  it("are listed with the wins left under the chapter's cap", () => {
    const list = skirmishList(camp(), ctx);
    expect(list.map((x) => [x.id, x.left, x.cap, x.open, x.loreUnread])).toEqual([['ridge', 2, 3, true, true]]);
    const capped = { ...camp(), skirmishWins: { chapter1: 3 } };
    expect(skirmishList(capped, ctx)[0]).toMatchObject({ left: 0, open: false });
  });

  it('a win pays out, counts against the cap, keeps the party in camp and leaves the wardens behind', () => {
    const c = camp();
    const info = deployInfo(c, ctx, 'ridge')!;
    const def = campContent.skirmishes.ridge!;
    let won: BattleState | null = null;
    for (let seed = 1; seed < 40 && !won; seed++) {
      const s = autoplay(
        createBattle(gameData.maps.skirmish_ridge!, battleSetup(c, { party: info.deployed, enemyLevelShift: info.enemyLevelShift }), seed, gameData),
      );
      if (s.result === 'victory') won = s;
    }
    expect(won).not.toBeNull();
    const next = completeSkirmish(c, won!, 'ridge', def, chapters, campContent.economy, 9);
    expect(next.skirmishWins).toEqual({ chapter1: 2 });
    expect(next.gold).toBe(c.gold + battleRewards(won!, def.rewards).gold);
    expect(next.shards).toBe(c.shards + 1);
    expect(next.party.map((u) => u.id)).toEqual(['mc']);
    expect(next.progress.stage).toBe('camp');
    expect(skirmishList(next, ctx)[0]!.left).toBe(1);
    expect(validateCampaign(next, { data: gameData, chapters }).ok).toBe(true);
  });
});

describe('wounded bearers and the fallen', () => {
  const cpt: typeof chapters = chapters.map((ch) => (ch.id === 'chapter1' ? { ...ch, plotCritical: ['ana'] } : ch));

  function fallenBattle(mode: 'classic' | 'casual'): { c: CampaignSave; s: BattleState } {
    const c = { ...bigParty(), settings: { difficulty: 'normal' as const, permadeath: mode } };
    const s = createBattle(gameData.maps.skirmish_ridge!, battleSetup(c, { party: c.party.slice(0, 4), enemyLevelShift: 0 }), 1, gameData);
    s.result = 'victory';
    for (const id of ['ana', 'bo']) {
      const u = s.units.find((x) => x.id === id)!;
      u.alive = false;
      u.hp = 0;
    }
    return { c, s };
  }

  it('in Classic a plot-critical bearer who falls retreats wounded for the act; others are lost', () => {
    const { c, s } = fallenBattle('classic');
    const out = applyPermadeath(s, 'classic', c, cpt);
    expect(out.wounded).toEqual(['ana']);
    expect(out.lost.map((u) => u.id)).toEqual(['bo']);
    const next = completeSkirmish(c, s, 'ridge', campContent.skirmishes.ridge!, cpt, campContent.economy, 3);
    expect(next.party.map((u) => u.id)).toEqual(['mc', 'ana', 'cy', 'di']);
    expect(next.fallen.map((u) => u.id)).toEqual(['bo']);
    expect(next.wounded).toEqual({ ana: 1 });
    expect(isWounded(next, 'ana', { chapters: cpt })).toBe(true);
    expect(deployInfo(next, { ...ctx, chapters: cpt }, 'ridge')!.units.find((u) => u.unit.id === 'ana')!.status).toBe('wounded');
    expect(validateCampaign(next, { data: gameData, chapters: cpt }).ok).toBe(true);
  });

  it('in Casual everyone comes back and no one is wounded', () => {
    const { c, s } = fallenBattle('casual');
    const next = completeSkirmish(c, s, 'ridge', campContent.skirmishes.ridge!, cpt, campContent.economy, 3);
    expect(next.party.map((u) => u.id)).toEqual(['mc', 'ana', 'bo', 'cy', 'di']);
    expect(next.fallen).toEqual([]);
    expect(next.wounded).toEqual({});
  });

  it('the wound heals when the story moves on to a new act', () => {
    const acts = chapters.map((ch) =>
      ch.id === 'chapter1' ? { ...ch, mapId: 'prologue', campAfter: undefined } : ch.id === 'chapter2' ? { ...ch, act: 2 } : ch,
    );
    const c: CampaignSave = { ...camp(), wounded: { mc: 1 }, progress: { current: 'chapter1', completed: ['prologue'], stage: 'outro', scenes: [] } };
    const next = settle(c, acts, gameData, 9);
    expect(next.progress.current).toBe('chapter2');
    expect(next.wounded).toEqual({});
  });
});

describe('the camp hub', () => {
  it('opens the facilities a finished chapter unlocked, and says when the others open', () => {
    expect(facilityOpen(camp(), 'forge', ctx)).toBe(true);
    const none = chapters.map((ch) => ({ ...ch, campAfter: ch.id === 'prologue' ? { unlocks: ['barracks' as const] } : ch.campAfter }));
    expect(facilityOpen(camp(), 'forge', { chapters: none })).toBe(false);
    expect(facilityOpensText(camp(), 'forge', { chapters: none })).toBe('Opens after Chapter 2');
    expect(facilityOpensText(camp(), 'forge', ctx)).toBe('Opens after Chapter 2');
    expect(campBackdrop(camp(), ctx)).toBe('camp');
  });

  it('offers the campfire talk, marks it read, and keeps the choice flags', () => {
    const fresh = { ...camp(), flags: { prologue_promise: true } };
    expect(talkList(fresh, ctx)).toEqual([{ scene: 'camp_first_night', title: 'The first night', flag: 'read_camp_first_night', read: false }]);
    const read = readTalk(fresh, 'camp_first_night', { told: true }, ctx, 7);
    expect(talkList(read, ctx)[0]!.read).toBe(true);
    expect(read.flags.told).toBe(true);
  });

  it("the war map: the route, chapter 1 coming soon, and leaving camp starts a chapter's intro", () => {
    const c = camp();
    expect(routeNodes(c, ctx).map((n) => n.kind)).toEqual(['done', 'next', 'later', 'later']);
    expect(routeNodes(c, ctx)[1]).toMatchObject({ chapterId: 'chapter1', playable: false });
    expect(startableChapter(c, ctx)).toBeNull();
    const playable = chapters.map((ch) => (ch.id === 'chapter1' ? { ...ch, mapId: 'prologue' } : ch));
    expect(startableChapter(c, { ...ctx, chapters: playable })).toBe('chapter1');
    const left = settle(leaveCamp(c, 5), playable, gameData, 5);
    expect(left.progress).toEqual({ current: 'chapter1', completed: ['prologue'], stage: 'intro', scenes: ['ch1_intro'] });
    expect(flowStep(c, chapters, gameData)).toMatchObject({ kind: 'camp' });
  });
});

describe('the shipped camp content', () => {
  it('names only real maps, scenes, weapons, items and skirmishes', async () => {
    const { scenes } = await import('../src/data/story');
    for (const [id, sk] of Object.entries(campContent.skirmishes)) {
      expect(gameData.maps[sk.mapId], id).toBeDefined();
      if (sk.lore) expect(scenes[sk.lore], sk.lore).toBeDefined();
      for (const d of sk.rewards.drops ?? []) expect(gameData.items[d.item], d.item).toBeDefined();
    }
    for (const ch of chapters) for (const id of ch.skirmishes?.ids ?? []) expect(campContent.skirmishes[id], id).toBeDefined();
    for (const [mapId, r] of Object.entries(campContent.economy.rewards)) {
      expect(gameData.maps[mapId], mapId).toBeDefined();
      for (const d of r.drops ?? []) expect(gameData.items[d.item], d.item).toBeDefined();
    }
    for (const shop of Object.values(campContent.economy.shops)) {
      for (const w of shop.weapons) expect(gameData.weapons[w]?.price, w).toBeGreaterThan(0);
      for (const it of shop.items) expect(gameData.items[it], it).toBeDefined();
    }
    expect(campContent.economy.upgradeCosts).toHaveLength(gameData.balance.weaponRanks.max);
  });
});
