/* HanziHome's sound cast: every Mandarin syllable is an initial, a final and a tone,
 * and each gets a picture, so a mnemonic can carry the sound as well as the meaning:
 * the initial is a pop-culture FIGURE, the final a BUILDING, the tone WHERE at that building:
 * 1 in Front of it, 2 Inside it, 3 its Basement, 4 its Bathroom, 5 on its Roof.
 * 半 bàn is Batman (b-), at the Mansion (-an), in its Bathroom (4).
 * Written for HanziHome; build/mnemonics/BRIEF.md says how the mnemonics use them.
 * Keys as Learn.soundOf() gives them: finals with v for ü, "ih" for the buzzing -i of
 * zhi chi shi ri zi ci si, "" for no initial. [name, why it fits, label] */
HZ.sounds = {
  initials: {
    '': ['Casper', 'No one stands at the front of the syllable: only Casper the ghost.', 'Ø'],
    b: ['Batman', 'b as in Batman.'], p: ['Pikachu', 'p as in Pikachu.'], m: ['Mario', 'm as in Mario.'],
    f: ['Frodo', 'f as in Frodo.'], d: ['Darth Vader', 'd as in Darth Vader.'], t: ['Tarzan', 't as in Tarzan.'],
    n: ['Naruto', 'n as in Naruto.'], l: ['Lara Croft', 'l as in Lara Croft.'], g: ['Gandalf', 'g as in Gandalf.'],
    k: ['Kermit', 'k as in Kermit.'], h: ['Homer', 'h as in Homer, a breathy h from the throat.'],
    j: ['James Bond', 'j as in James Bond, the tongue flat behind the lower teeth.'],
    q: ['Chewbacca', 'q sounds like the ch of Chewbacca, with a puff of air.'],
    x: ['Shrek', 'x sounds like the sh of Shrek, said with a smile.'],
    zh: ['Joker', 'zh sounds like the j of Joker, the tongue curled back.'],
    ch: ['Charlie Brown', 'ch as in Charlie Brown, the tongue curled back, with a puff of air.'],
    sh: ['Sherlock', 'sh as in Sherlock, the tongue curled back.'],
    r: ['Robocop', 'r as in Robocop, the tongue curled back.'],
    z: ['Zorro', 'z as in Zorro, but softer: the ds at the end of "kids".'],
    c: ['Cookie Monster', 'c sounds like the ts of "eats", which is all Cookie Monster does, with a puff of air.'],
    s: ['Sailor Moon', 's as in Sailor Moon.'],
    y: ['Yoshi', 'y as in Yoshi.'], w: ['Walter White', 'w as in Walter White.'],
  },
  finals: {
    a: ['Spa', '-a sounds like the "ah" of a relaxing spa.'],
    o: ['Fort', '-o sounds like the "aw" of Fort.'],
    e: ['Hut', '-e sounds like the "uh" of Hut.'],
    ai: ['Island', '-ai sounds like the "eye" of Island.'],
    ei: ['Lake', '-ei sounds like the "ay" of Lake.'],
    ao: ['Tower', '-ao sounds like the "ow" of Tower.'],
    ou: ['Boathouse', '-ou sounds like the "oh" of Boathouse.'],
    an: ['Mansion', '-an sounds like the "ahn" of Mansion.'],
    en: ['Funfair', '-en sounds like the "un" of Funfair.'],
    ang: ['Hangar', '-ang sounds like the "ahng" of Hangar.'],
    eng: ['Jungle', '-eng sounds like the "ung" of Jungle.'],
    ong: ['Lagoon', '-ong sounds like the "oong" of Lagoon.'],
    er: ['Car Park', 'er sounds like the "ar" of Car Park, the tongue curled back.'],
    i: ['Beach', '-i sounds like the "ee" of Beach.'],
    ih: ['Beehive', 'After zh ch sh r z c s, -i is a buzz, like a Beehive.'],
    ia: ['Piazza', '-ia sounds like the "yah" of Piazza.'],
    ie: ['Yeti Cave', '-ie sounds like the "yeh" of Yeti.'],
    iao: ['Cat Café', '-iao sounds like a cat\'s "meow".'],
    iu: ['Youth Hostel', '-iu sounds like the "yo" of Youth Hostel.'],
    ian: ['Yen Exchange', '-ian sounds like the "yen" of Yen Exchange.'],
    in: ['Inn', '-in sounds like the "een" of Inn.'],
    iang: ['Stadium', '-iang sounds like "yahng": a Stadium full of young fans.'],
    ing: ['Boxing Ring', '-ing sounds like the "ing" of Boxing Ring.'],
    iong: ['Youth Club', '-iong sounds like the "yoong" of Youth Club.'],
    u: ['Pool', '-u sounds like the "oo" of Pool.'],
    ua: ['Water Park', '-ua sounds like the "wah" of Water Park.'],
    uo: ['Warehouse', '-uo sounds like the "waw" of Warehouse.'],
    uai: ['Wine Cellar', '-uai sounds like the "why" of Wine Cellar.'],
    ui: ['Waiting Room', '-ui sounds like the "way" of Waiting Room.'],
    uan: ['Swan Pond', '-uan sounds like the "wahn" of Swan Pond.'],
    un: ['Casino', '-un sounds like "won": what you hope at a Casino.'],
    uang: ['Swamp', '-uang sounds like "wahng", deep in a Swamp.'],
    v: ['Museum', 'ü sounds like the "ew" of Museum, the lips rounded.'],
    ve: ['Ice Rink', 'üe sounds like "yweh", gliding on an Ice Rink.'],
    van: ['Mint', 'üan sounds like "ywen": the Mint that makes coins.'],
    vn: ['Dunes', 'ün sounds like "yewn", across the Dunes.'],
  },
  tones: {
    1: ['Front', 'First tone: the scene happens in front of the building.'],
    2: ['Inside', 'Second tone: the scene happens inside the building.'],
    3: ['Basement', 'Third tone: the scene happens in the basement of the building.'],
    4: ['Bathroom', 'Fourth tone: the scene happens in the bathroom of the building.'],
    5: ['Roof', 'Fifth (neutral) tone: the scene happens on the roof of the building.'],
  },
  /* the syllable to hear each one on (site/audio/s/, first tone): a beginning can't be
     said alone, so the customary bo po mo fo; an ending alone where it can be, else as it
     is spelt at the start of a syllable (-ia: ya) */
  heard: {
    initials: {
      '': 'a', b: 'bo', p: 'po', m: 'mo', f: 'fo', d: 'de', t: 'te', n: 'ne', l: 'le', g: 'ge', k: 'ke', h: 'he',
      j: 'ji', q: 'qi', x: 'xi', zh: 'zhi', ch: 'chi', sh: 'shi', r: 'ri', z: 'zi', c: 'ci', s: 'si', y: 'yi', w: 'wu',
    },
    finals: {
      a: 'a', o: 'o', e: 'e', ai: 'ai', ei: 'ei', ao: 'ao', ou: 'ou', an: 'an', en: 'en', ang: 'ang', eng: 'eng',
      ong: 'dong', er: 'er', i: 'yi', ih: 'shi', ia: 'ya', ie: 'ye', iao: 'yao', iu: 'you', ian: 'yan', in: 'yin',
      iang: 'yang', ing: 'ying', iong: 'yong', u: 'wu', ua: 'wa', uo: 'wo', uai: 'wai', ui: 'wei', uan: 'wan',
      un: 'wen', uang: 'wang', v: 'yu', ve: 'yue', van: 'yuan', vn: 'yun',
    },
  },
};
