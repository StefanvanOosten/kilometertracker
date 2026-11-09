import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verdeelCenten, berekenPeriodes, saldi, overboekingen, laatsteStand, kiesStand, leesBedrag,
} from '../logic.js';

const rit = (persoon_id, begin_km, eind_km, datum = '2026-11-01') => ({ persoon_id, begin_km, eind_km, datum });
const tank = (bedrag_cent, km_stand, datum = '2026-11-05', betaald_door = 'a') => ({ bedrag_cent, km_stand, datum, betaald_door });

test('verdeelCenten telt precies op', () => {
  assert.deepEqual(verdeelCenten(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(verdeelCenten(1000, [0, 0]), [500, 500]);
  assert.equal(verdeelCenten(7777, [13, 29, 58]).reduce((s, x) => s + x, 0), 7777);
});

test('tankbeurt wordt naar kilometers verdeeld', () => {
  const { periodes } = berekenPeriodes([rit('a', 1000, 1100), rit('b', 1100, 1400)], [tank(8000, 1400)]);
  const p = periodes[0];
  assert.equal(p.totaalKm, 400);
  assert.equal(p.ongeregistreerdKm, 0);
  assert.equal(p.prijsPerKmCent, 20);
  assert.deepEqual(p.verdeling.map((v) => [v.persoon_id, v.bedrag_cent]), [['b', 6000], ['a', 2000]]);
});

test('niet geregistreerde kilometers worden naar verhouding verdeeld', () => {
  const { periodes } = berekenPeriodes([rit('a', 1000, 1100), rit('b', 1100, 1400)], [tank(10000, 1500)]);
  const p = periodes[0];
  assert.equal(p.ongeregistreerdKm, 100);
  assert.equal(p.prijsPerKmCent, 20);
  assert.equal(p.verdeling.find((v) => v.persoon_id === 'a').bedrag_cent, 2500);
  assert.equal(p.verdeling.find((v) => v.persoon_id === 'a').extraKm, 25);
  assert.equal(p.verdeling.find((v) => v.persoon_id === 'b').bedrag_cent, 7500);
});

test('tweede periode begint bij de stand van de vorige tankbeurt', () => {
  const ritten = [rit('a', 1000, 1200, '2026-11-01'), rit('b', 1200, 1300, '2026-11-06'), rit('a', 1320, 1400, '2026-11-07')];
  const { periodes, lopend } = berekenPeriodes(ritten, [tank(4000, 1200, '2026-11-02'), tank(4000, 1400, '2026-11-08')]);
  assert.equal(periodes[1].beginKm, 1200);
  assert.equal(periodes[1].ongeregistreerdKm, 20);
  assert.deepEqual(periodes[1].verdeling.map((v) => v.bedrag_cent).sort(), [1778, 2222]);
  assert.equal(lopend.geregistreerdKm, 0);
});

test('rit over een tankbeurt heen wordt gesplitst', () => {
  const { periodes, lopend } = berekenPeriodes([rit('a', 1000, 1200)], [tank(5000, 1100)]);
  assert.equal(periodes[0].geregistreerdKm, 100);
  assert.equal(lopend.geregistreerdKm, 100);
  assert.equal(lopend.verdeling[0].schattingCent, 5000);
});

test('tankbeurt zonder stand gebruikt de ritten tot die datum', () => {
  const ritten = [rit('a', 1000, 1100, '2026-11-01'), rit('b', 1100, 1300, '2026-11-09')];
  const { periodes, lopend } = berekenPeriodes(ritten, [tank(3000, null, '2026-11-05')]);
  assert.equal(periodes[0].eindKm, 1100);
  assert.equal(periodes[0].verdeling.length, 1);
  assert.equal(lopend.geregistreerdKm, 200);
});

test('saldi en overboekingen', () => {
  const personen = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const { periodes } = berekenPeriodes(
    [rit('a', 0, 100), rit('b', 100, 200), rit('c', 200, 300)],
    [tank(9000, 300, '2026-11-05', 'a')],
  );
  const s = saldi(personen, periodes, [{ van_persoon: 'b', naar_persoon: 'a', bedrag_cent: 1000 }]);
  assert.equal(s.get('a'), 5000);
  assert.equal(s.get('b'), -2000);
  assert.equal(s.get('c'), -3000);
  assert.deepEqual(overboekingen(s), [{ van: 'c', naar: 'a', bedrag_cent: 3000 }, { van: 'b', naar: 'a', bedrag_cent: 2000 }]);
});

test('laatsteStand, kiesStand en leesBedrag', () => {
  assert.equal(laatsteStand([rit('a', 1, 50)], [tank(1, 80)]), 80);
  assert.equal(kiesStand([12, 45210, 45188, 2026], 45190), 45210);
  assert.equal(kiesStand([45210, 312], null), 45210);
  assert.equal(leesBedrag('€ 72,35'), 7235);
  assert.equal(leesBedrag('1.072,35'), 107235);
  assert.equal(leesBedrag('abc'), null);
});
