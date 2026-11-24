/* HanziHome's second sound cast (see SOUND_CAST_DRAFT.md): a syllable is a BEGINNING
 * (a consonant, with the glide i-, u- or ü- that follows it: b-, bi-, bu-), an ENDING
 * (what is left: -an, -(e)ng, or nothing at all) and a tone.
 *   node build/mnemonics/cast2.js         prints every taught syllable's split
 * split(letters) takes Learn.parsePinyin(pin).letters (ü written v) and returns
 * {beginning, ending} as keys of BEGINNINGS and ENDINGS, or null.
 * BEGINNINGS: key -> [name, why, label, pronoun, short name, powers for the brief] */
'use strict';

const BEGINNINGS = {
  '': ['Invisible Man', 'No beginning sound: nobody there but the Invisible Man.', '_', 'he', 'the Invisible Man', 'unseen except for his bandages, coat, hat and dark glasses; things float and move by themselves around him; unwraps to vanish; startles people; leaves footprints only'],
  b: ['Batman', 'b as in Batman.', 'b', 'he', 'Batman', 'cape and glide, utility belt with a gadget for everything, batarangs, grappling hook, gruff voice, brooding detective, Batmobile, butler Alfred'],
  p: ['Pac-Man', 'p as in Pac-Man.', 'p', 'he', 'Pac-Man', 'yellow circle, mouth that chomps "waka waka" through rows of dots, eats power pellets, chased by four ghosts, races through mazes, wraps round the edge of the screen'],
  m: ['Madonna', 'm as in Madonna.', 'm', 'she', 'Madonna', 'pop queen: reinvents her look every time, cone outfits, strikes a pose ("Vogue"), headset microphone, huge stage shows, dancers'],
  f: ['Fred Flintstone', 'f as in Fred Flintstone.', 'f', 'he', 'Fred', 'caveman, stone-age car powered by his feet, "Yabba dabba doo!", quarry, dinosaur crane, pet dinosaur Dino, bowling, loud and hasty'],
  d: ['Darth Vader', 'd as in Darth Vader.', 'd', 'he', 'Vader', 'black helmet, loud breathing, cape, lifts and squeezes objects with the Force, red lightsaber, booming disapproval, "I am your father"'],
  t: ['Tony Stark', 't as in Tony Stark, Iron Man.', 't', 'he', 'Tony', 'Iron Man suit that flies with hand and boot jets, repulsor blasts, builds any gadget in minutes, AI butler JARVIS, show-off, quips, glowing chest reactor'],
  n: ['Nadal', 'n as in Rafael Nadal, the tennis star.', 'n', 'he', 'Nadal', 'tennis: thundering topspin forehand, sleeveless shirt, headband, tidies his water bottles just so, tugs his shorts before each serve, bites the trophy, king of clay courts, never gives up a point'],
  l: ['Lara Croft', 'l as in Lara Croft.', 'l', 'she', 'Lara', 'tomb raider, ponytail, acrobatic, ancient traps and rolling boulders, relics, puzzles, climbs anything (never shoots anyone)'],
  g: ['Garfield', 'g as in Garfield.', 'g', 'he', 'Garfield', 'fat orange cat, lasagne, hates Mondays, naps everywhere, lazy, sarcastic, kicks Odie the dog off the table'],
  k: ['King Kong', 'k as in King Kong.', 'k', 'he', 'Kong', 'giant ape, beats his chest and roars, climbs skyscrapers, swats biplanes, carries people gently in his huge hand'],
  h: ['Homer Simpson', 'h as in Homer Simpson.', 'h', 'he', 'Homer', 'bald, doughnuts, "D\'oh!", lazy, naps at the nuclear plant, dim schemes that backfire, "Mmm…", strangles nobody (no Bart-choking), no beer'],
  zh: ['Joker', 'zh sounds like the j of Joker, the tongue curled back.', 'zh', 'he', 'the Joker', 'purple suit, green hair, huge grin, squirting flower, trick playing cards, cackling, everything is a prank (harmless pranks only)'],
  ch: ['Charlie Chaplin', 'ch as in Charlie Chaplin, the tongue curled back, with a puff of air.', 'ch', 'he', 'Chaplin', 'silent-film tramp: bowler hat, cane, toothbrush moustache, baggy trousers, waddle, slapstick tumbles, never speaks, mimes everything'],
  sh: ['Shakira', 'sh as in Shakira, the tongue curled back.', 'sh', 'she', 'Shakira', 'pop star: hips that don\'t lie, belly dancing, long curly hair, "Waka Waka" football song, sings on any stage'],
  r: ['Rocky', 'r as in Rocky, the tongue curled back.', 'r', 'he', 'Rocky', 'boxer Rocky Balboa: punches sides of meat, runs up long stairs and raises his fists, trains with raw eggs, the training music, "Adrian!", never stays down'],
  z: ['Zorro', 'z as in Zorro, but softer: the ds at the end of "kids".', 'z', 'he', 'Zorro', 'black mask and cape, rapier, slashes a Z into anything, black horse, swings from chandeliers, dashing, vanishes laughing'],
  c: ['Cookie Monster', 'c sounds like the ts of "eats", which is all Cookie Monster does, with a puff of air.', 'c', 'he', 'Cookie Monster', 'blue, furry, googly eyes, devours everything in a spray of crumbs, "Me want cookie!", talks in "me"'],
  s: ['Sonic', 's as in Sonic the Hedgehog.', 's', 'he', 'Sonic', 'blue hedgehog, runs faster than sound, spins into a ball, collects gold rings and drops them all when hit, loops, taps his foot when kept waiting'],
  y: ['Yoda', 'y as in Yoda.', 'y', 'he', 'Yoda', 'tiny green Jedi master, backwards speech ("Strong with the Force, you are"), walking stick, lifts things with the Force, swamp hut, 900 years old, surprising sword flips'],
  w: ['Wonder Woman', 'w as in Wonder Woman.', 'w', 'she', 'Wonder Woman', 'Amazon warrior: golden lasso that makes anyone tell the truth, bullet-deflecting bracelets, tiara, shield, invisible jet, super strength'],
  bi: ['Beyoncé', 'bi- as in Beyoncé.', 'bi', 'she', 'Beyoncé', 'pop queen: wind machine blowing her hair, powerful voice, perfect dance routines, "Single Ladies" hand wave, lemonade, fans called the Beyhive'],
  bu: ['Buddha', 'bu- as in Buddha.', 'bu', 'he', 'the Buddha', 'sits calmly cross-legged under a tree, peaceful smile, meditates through any chaos, kind teaching, lotus flower (always respectful: he stays serene, the chaos happens around him)'],
  pi: ['Pikachu', 'pi- as in Pikachu.', 'pi', 'he', 'Pikachu', 'small, yellow, cheek sparks, Thunderbolt, says only "Pika!", lives in a Poké Ball, gets caught'],
  pu: ['Winnie the Pooh', 'pu- as in Pooh.', 'pu', 'he', 'Pooh', 'small honey-loving bear, head stuck in honey pots, "oh bother", friends Piglet and Tigger, gentle and muddled, stuck in a rabbit hole'],
  mi: ['Mr. Bean', 'mi- as in Mister Bean.', 'mi', 'he', 'Mr. Bean', 'silent, rubbery face, tweed jacket, tiny green car, teddy bear, solves small problems in absurd sneaky ways, makes a mess of everything'],
  mu: ['Muhammad Ali', 'mu- as in Muhammad.', 'mu', 'he', 'Ali', 'boxing champion: "float like a butterfly, sting like a bee", fast footwork and shuffle, rhyming boasts, "I am the greatest"'],
  fu: ['Nick Fury', 'fu- as in Fury.', 'fu', 'he', 'Fury', 'S.H.I.E.L.D. boss: eyepatch, long black coat, flying helicarrier, assembles teams of heroes, stern orders, knows every secret'],
  di: ['Deadpool', 'di- as in Deadpool.', 'di', 'he', 'Deadpool', 'red suit and mask, two katanas, talks to the audience, never stops joking, heals from anything instantly, loves chimichangas (no gore)'],
  du: ['Dua Lipa', 'du- as in Dua Lipa.', 'du', 'she', 'Dua Lipa', 'pop star: disco dance-floor songs, "New Rules" counted on her fingers, glitter, levitating on stage, roller skates, cool and composed'],
  ti: ['Tinker Bell', 'ti- as in Tinker Bell.', 'ti', 'she', 'Tinker Bell', 'tiny fairy, pixie dust that makes things fly, jingles like a bell, jealous and fiery, glows brighter when cross, mends pots, friend Peter Pan'],
  tu: ['Tupac', 'tu- as in Tupac.', 'tu', 'he', 'Tupac', 'rap legend: bandana, rhymes for everything, poet, microphone, freestyles a verse about whatever happens, calm cool stare (no crime or violence)'],
  ni: ['Nemo', 'ni- as in Nemo.', 'ni', 'he', 'Nemo', 'small clownfish with one little fin, lost and found, dentist\'s fish tank, swims with turtles and forgetful Dory, lives in a sea anemone'],
  nu: ['Noah', 'nu- as in Noah.', 'nu', 'he', 'Noah', 'long white beard, builds a huge wooden ark, loads every animal two by two, rain and floodwater, dove with an olive branch (always respectful and gentle)'],
  nv: ['Isaac Newton', 'nü- sounds like the "new" of Newton, the lips rounded.', 'nü', 'he', 'Newton', 'scientist in a long curly wig: an apple falls on his head and he discovers gravity, prisms split light into rainbows, laws of motion, telescope, everything falls when he thinks of it'],
  li: ['Lisa Simpson', 'li- as in Lisa.', 'li', 'she', 'Lisa', 'clever girl with a spiky head, saxophone solos, straight A grades, vegetarian, protests and petitions, wise beyond her years, sighs at Bart'],
  lu: ['Luigi', 'lu- as in Luigi.', 'lu', 'he', 'Luigi', 'tall plumber in green, moustache, high wobbly jump, scared of ghosts, vacuums them up with his ghost hoover, always in his brother\'s shadow'],
  lv: ['Lucifer', 'lü- sounds like the "loo" of Lucifer, the lips rounded.', 'lü', 'he', 'Lucifer', 'charming devil (the comic kind): red horns and tail, pitchfork, little puffs of fire and smoke, makes cheeky deals, sulks when ignored'],
  gu: ['Gru', 'gu- as in Gru.', 'gu', 'he', 'Gru', 'bald supervillain turned dad: long scarf, freeze ray, shrink ray, hundreds of yellow Minions who mess everything up, plans to steal the moon'],
  ku: ['Kung Fu Panda', 'ku- as in Kung Fu Panda.', 'ku', 'he', 'Po', 'big clumsy panda, kung fu master, dumplings, noodle shop, belly bounces, "Skadoosh!", Furious Five friends, wise turtle Oogway'],
  hu: ['Houdini', 'hu- as in Houdini.', 'hu', 'he', 'Houdini', 'escape artist: breaks out of chains, locks, handcuffs, straitjackets and water tanks, vanishes elephants, magic tricks, ta-da!'],
  ji: ['Jim Carrey', 'ji- as in Jim.', 'ji', 'he', 'Jim Carrey', 'rubber-faced comic actor: the Mask\'s green face and zoot suit, "Smokin\'!", "Alrighty then!", pulls impossible faces, pulls impossible faces, mimics anyone, slapstick pratfalls'],
  ju: ['Juliet', 'ju- sounds like the "Ju" of Juliet, the lips rounded.', 'ju', 'she', 'Juliet', 'Shakespeare\'s romantic heroine: balcony, "Wherefore art thou Romeo?", love letters, sighs, swoons, roses, feuding families (no deaths)'],
  qi: ['Chip', 'qi- sounds like the "chi" of Chip, with a puff of air.', 'qi', 'he', 'Chip', 'little chipmunk of Chip \'n Dale: stuffs his cheeks with acorns, squeaky voice, scampers up trees, steals food with brother Dale, outwits big Donald Duck'],
  qu: ['Chupacabra', 'qu- sounds like the "Chu" of Chupacabra, the lips rounded.', 'qu', 'it', 'the Chupacabra', 'legendary spiky-backed goat-sucker of the night: glowing red eyes, sneaks round farms, nobody ever gets a good photo, hisses, (silly not scary: it only sips milk)'],
  xi: ['Shiva', 'xi- sounds like the "Shi" of Shiva, said with a smile.', 'xi', 'he', 'Shiva', 'Hindu god of dance: four arms, cosmic dance in a ring of fire, third eye, trident, snake around his neck, blue throat, drum (always respectful and majestic)'],
  xu: ['Michael Schumacher', 'xu- sounds like the "Schu" of Schumacher, said with rounded lips.', 'xu', 'he', 'Schumacher', 'Formula One champion: red racing car, pit stops in two seconds, champagne spray on the podium, helmet and race suit, overtakes everything'],
  zhu: ['Judy Hopps', 'zhu- sounds like the "Ju" of Judy, the tongue curled back.', 'zhu', 'she', 'Judy', 'rabbit police officer from Zootopia: badge, carrot pen recorder, writes parking tickets at top speed, hops high, optimistic, sly fox partner Nick'],
  chu: ['Chewbacca', 'chu- as in Chewbacca, the tongue curled back.', 'chu', 'he', 'Chewbacca', 'huge, hairy, roars and growls that only friends understand, bandolier, crossbow, very loyal, rips things apart in a temper, fixes ships'],
  shu: ['Shuri', 'shu- as in Shuri, the tongue curled back.', 'shu', 'she', 'Shuri', 'princess and genius inventor of Wakanda: vibranium gadgets, sonic gauntlets, holograms, makes everything high-tech, teases her big brother'],
  ru: ['RuPaul', 'ru- as in RuPaul.', 'ru', 'she', 'RuPaul', 'drag superstar: towering wig, sequinned gown, catwalk, "Sashay away!", "Good luck, and don\'t mess it up!", makeover of anything'],
  zu: ['Zoolander', 'zu- sounds like the "Zoo" of Zoolander, said softer.', 'zu', 'he', 'Zoolander', 'vain male model: the "Blue Steel" pout, can\'t turn left, catwalk walk-off, really, really ridiculously good-looking, not very bright'],
  cu: ['Cuphead', 'cu- sounds like a soft "tsu", the Cup of Cuphead.', 'cu', 'he', 'Cuphead', 'cartoon cup with a straw in his head, 1930s rubber-hose style, finger-gun blasts, dashes and parries pink things, fights giant bosses with brother Mugman'],
  su: ['Dr. Seuss', 'su- as in Seuss.', 'su', 'he', 'Dr. Seuss', 'author of rhyming picture books: Cat in the Hat, green eggs and ham, wobbly towers of things, everything said in bouncy rhyme, invents silly creatures'],
  yu: ['Usain Bolt', 'yu- sounds like the "U" of Usain, the lips rounded.', 'yu', 'he', 'Bolt', 'fastest sprinter alive: the lightning-bolt pose, crosses the line first, gold medals, a blur on the track, dances before races'],
};

const ENDINGS = {
  '': ['Shed', 'No ending: the syllable stops after its beginning (yi, wu, zhi, bu, ji, nü), like an empty Shed.', '-_'],
  a: ['Spa', '-a sounds like the "ah" of a relaxing Spa.', '-a'],
  o: ['Fort', '-o sounds like the "aw" of Fort.', '-o'],
  e: ['Hut', '-e sounds like the "uh" of Hut (after i- or ü-: the "eh" of yeti).', '-e'],
  ai: ['Island', '-ai sounds like the "eye" of Island.', '-ai'],
  ei: ['Lake', '-(e)i sounds like the "ay" of Lake: -ei, and the -i of gui, dui.', '-(e)i'],
  ao: ['Tower', '-ao sounds like the "ow" of Tower.', '-ao'],
  ou: ['Boathouse', '-(o)u sounds like the "oh" of Boathouse: -ou, and the -u of jiu, liu.', '-(o)u'],
  an: ['Mansion', '-an sounds like the "ahn" of Mansion.', '-an'],
  en: ['Funfair', '-(e)n sounds like the "un" of Funfair: -en, and the -n of jin, lun, jun.', '-(e)n'],
  ang: ['Hangar', '-ang sounds like the "ahng" of Hangar.', '-ang'],
  eng: ['Jungle', '-(e)ng sounds like the "ung" of Jungle: -eng, and the -ng of jing.', '-(e)ng'],
  ong: ['Lagoon', '-ong sounds like the "oong" of Lagoon.', '-ong'],
  er: ['Car Park', 'er sounds like the "ar" of Car Park, the tongue curled back.', '-er'],
};

const TONES = {
  1: ['Front', 'First tone: the scene happens in front of the building.'],
  2: ['Inside', 'Second tone: the scene happens inside the building.'],
  3: ['Basement', 'Third tone: the scene happens in the basement of the building.'],
  4: ['Bathroom', 'Fourth tone: the scene happens in the bathroom of the building.'],
  5: ['Roof', 'Fifth (neutral) tone: the scene happens on the roof of the building.'],
};

/* the syllable to hear each one on (site/audio/s/, first tone) */
const HEARD = {
  beginnings: {
    '': 'a', b: 'bo', p: 'po', m: 'mo', f: 'fo', d: 'de', t: 'te', n: 'ne', l: 'le', g: 'ge', k: 'ke', h: 'he',
    zh: 'zhi', ch: 'chi', sh: 'shi', r: 'ri', z: 'zi', c: 'ci', s: 'si', y: 'ya', w: 'wa',
    bi: 'bi', bu: 'bu', pi: 'pi', pu: 'pu', mi: 'mi', mu: 'mu', fu: 'fu', di: 'di', du: 'du', ti: 'ti', tu: 'tu',
    ni: 'ni', nu: 'nu', nv: 'nv', li: 'li', lu: 'lu', lv: 'lv', gu: 'gu', ku: 'ku', hu: 'hu',
    ji: 'ji', ju: 'ju', qi: 'qi', qu: 'qu', xi: 'xi', xu: 'xu', zhu: 'zhu', chu: 'chu', shu: 'shu', ru: 'ru',
    zu: 'zu', cu: 'cu', su: 'su', yu: 'yu',
  },
  endings: {
    '': '', a: 'a', o: 'o', e: 'e', ai: 'ai', ei: 'ei', ao: 'ao', ou: 'ou', an: 'an', en: 'en', ang: 'ang', eng: 'eng',
    ong: 'dong', er: 'er',
  },
};

/* what is left after a glide: jiu -> ou, jin -> en, jing -> eng, gui -> ei, lun -> en */
const AFTER = { '': '', i: 'ei', u: 'ou', n: 'en', ng: 'eng' };
const after = r => (r in AFTER ? AFTER[r] : r);

function split(letters) {
  const s = String(letters).toLowerCase();
  const m = /^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(.*)$/.exec(s);
  const ini = m[1] || '', rest = m[2];
  let b, e;
  if (!/[aeiouv]/.test(rest)) return null;               // ng, hm, m
  if (ini === 'y') {
    if (rest[0] === 'u') { b = 'yu'; e = after(rest.slice(1)); }
    else { b = 'y'; e = rest === 'i' ? '' : rest[0] === 'i' ? after(rest.slice(1)) : rest; }
  } else if (ini === 'w') { b = 'w'; e = rest === 'u' ? '' : rest; }
  else if (/^[jqx]$/.test(ini)) {
    if (rest[0] === 'i') { b = ini + 'i'; e = after(rest.slice(1)); }
    else if (rest[0] === 'u' || rest[0] === 'v') { b = ini + 'u'; e = after(rest.slice(1)); }
    else return null;
  } else if (/^[nl]$/.test(ini) && rest[0] === 'v') { b = ini + 'v'; e = after(rest.slice(1)); }
  else if (/^(zh|ch|sh|r|z|c|s)$/.test(ini) && rest === 'i') { b = ini; e = ''; }
  else if (/^[bpmdtnl]$/.test(ini) && rest[0] === 'i') { b = ini + 'i'; e = after(rest.slice(1)); }
  else if (ini && rest[0] === 'u') { b = ini + 'u'; e = after(rest.slice(1)); }
  else { b = ini; e = rest; }
  if (!(b in BEGINNINGS) || !(e in ENDINGS)) return null;
  return { beginning: b, ending: e };
}

module.exports = { BEGINNINGS, ENDINGS, TONES, HEARD, split };

if (require.main === module) {
  const path = require('path'), fs = require('fs');
  const ROOT = path.join(__dirname, '..', '..');
  global.HZ = {};
  for (const f of ['index.js', 'cmnem.js']) require(path.join(ROOT, 'site', 'data', f));
  const Learn = require(path.join(ROOT, 'site', 'learn.js'));
  const seen = new Map(), bad = [];
  for (const c of Object.keys(HZ.cmnem)) {
    const pin = HZ.cmnem[c][2] || HZ.index[c][2], L = Learn.parsePinyin(pin).letters, sp = split(L);
    if (!sp) bad.push(c + ' ' + pin + ' ' + L);
    else seen.set(L, sp.beginning + '|' + sp.ending);
  }
  const use = {};
  for (const v of seen.values()) { const [b, e] = v.split('|'); use['b:' + b] = 1; use['e:' + e] = 1; }
  console.log([...seen].sort().map(([l, v]) => l + '=' + v).join(' '));
  console.log('unsplit:', bad.join(', ') || 'none');
  console.log('unused beginnings:', Object.keys(BEGINNINGS).filter(b => !use['b:' + b]).join(' ') || 'none');
  console.log('unused endings:', Object.keys(ENDINGS).filter(e => !use['e:' + e]).join(' ') || 'none');
  const miss = [...Object.values(HEARD.beginnings), ...Object.values(HEARD.endings)].filter(x => x && !fs.existsSync(path.join(ROOT, 'site', 'audio', 's', x + '1.mp3')));
  console.log('missing audio:', miss.join(' ') || 'none');
}
