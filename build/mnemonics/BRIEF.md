# Writing HanziHome's names, mnemonics and examples

HanziHome teaches Chinese characters and words to English speakers. Learners meet each
item in a lesson that shows its parts and a mnemonic, then review it with spaced
repetition. Everything here is written fresh for HanziHome. Do not copy or recall
another app's or book's names or mnemonics (HanziHero, Heisig, Remembering Simplified
Hanzi, Skritter, Outlier and the like): write your own.

The inputs are in `build/mnemonics/in/`. Write each result to `build/mnemonics/out/`
under the same file name: one JSON array, one object per input entry, in the input's
order, as UTF-8, with nothing else in the file. Use a short Node script, or write the
JSON by hand, but check every file you write parses:
`node -e "JSON.parse(require('fs').readFileSync('build/mnemonics/out/NAME.json','utf8'))"`
and that it has exactly as many entries as the input, with the same keys in the same order.

Write plain English: short sentences, concrete pictures, no puns that need an accent,
nothing gory, sexual or mean about real groups of people. British or American spelling
is fine.

## 1. Components: `components.json`

Input: `{c, meaning, pin, examples}`: a component, its dictionary meaning (may be
empty or abstract), and common characters it is in.

Output: `{"c": "勺", "name": "ladle", "why": "A curved scoop with a drop of soup in it."}`

* `name`: a picture name, one to three lowercase words, that a learner can *see*: a
  thing, an animal, a person, a place. Keep the dictionary meaning when it already is
  one (口 mouth, 木 tree, 女 woman, 氵 water). Otherwise choose from the shape or the
  meaning (丷 "horns", 亠 "lid", 冖 "cloth cover", 𤴓 "foot stop"). Single strokes get
  names too (㇒ "slide", 丶 "drop").
* Names should be different from each other. A variant form may share a name with
  its full form plus a word that marks it (人 "person", 亻 "standing person";
  水 "water", 氵 "water drops").
* `why`: one sentence, at most 15 words, saying what the picture is or why it is
  called that.

## 2. Characters: `chars-NN.json`

Input: `{c, rank, pin, meaning, parts}`: the character, its frequency rank, pinyin,
meanings and its components. The components' picture names are in
`build/mnemonics/out/components.json`: look each one up there and use those names.

Output:
`{"c": "好", "key": "good", "m": "A *woman* holding her *child*: that is a **good** thing."}`

* `key`: the meaning to learn, one to three words, the commonest sense (好 "good",
  的 "possessive particle" is too abstract, say "of"). It must be one of the input's
  meanings or close to it.
* `m`: the mnemonic, one or two sentences, at most 35 words. A little scene that uses
  every component's picture name, each written between single asterisks (`*woman*`),
  and ends in the meaning, the `key`, between double asterisks (`**good**`). Use the
  component names exactly as `components.json` has them (a plural or -ing form is fine).
  When a character has no parts, or is itself a component, make a scene from its
  shape. Make the scene explain the meaning: the picture should lead to the meaning,
  not just sit next to it.
* Particles and grammar words (的, 了, 吗, 着) get a scene about what they do.

## 3. Words: `words-NN.json`

Input: `{w, rank, pin, meaning, chars}`: a word, its frequency rank, pinyin, meanings,
and each character with its own meaning.

Output:
```json
{"w": "电脑", "pos": "noun", "m": "An **electric** **brain** sits on your desk: the **computer**.",
 "ex": [["我的电脑太慢了。", "My computer is too slow."],
        ["他每天用电脑工作。", "He works on a computer every day."]],
 "use": "Measure word 台 (a computer) or 部."}
```

* `pos`: noun, verb, adjective, adverb, measure word, pronoun, conjunction,
  preposition, particle, number, phrase, idiom, name, or two of these joined by " / ".
* `m`: a mnemonic, one or two sentences, at most 30 words, that joins the characters'
  meanings (each between double asterisks) into the word's meaning (also between double
  asterisks). When the word's meaning follows plainly from its characters, say so
  simply ("**Electric** **brain**: a **computer**."). For names of places and people
  say what the characters mean and that it is a name.
* `ex`: two example sentences, each `[Chinese, English]`. Simplified characters, full
  Chinese punctuation (。，？！). Natural, everyday Chinese a learner would meet, using the
  word exactly as written (every character of it, in order) in its commonest sense.
  Keep them short: 6 to 16 characters for the first, up to 22 for the second, and use
  common characters around the word (HSK 1–4 vocabulary where you can). Show two
  different uses or positions where the word has them. The English is a faithful,
  natural translation. Do not add pinyin: the app writes it.
* `use`: one short note, at most 20 words, of what a learner should know: its measure
  word, what it goes with (常和…连用: say it in English), formal or spoken, a
  difference from a near word. An empty string when there is nothing useful to say.

Check your Chinese. Every example must be grammatical, and must contain the word.

## 4. Components, round two: `components-2.json`

As section 1: `{c, meaning, pin, parts, examples}` in, `{c, name, why}` out, to
`out/components-2.json`. These are the first-level parts of common characters (尚, 争,
平, 君) that had no picture name yet. Many are characters in their own right: keep a
plain concrete meaning when the character has one (平 "flat", 君 "lord", 光 "light"),
otherwise name the picture. Every name must differ from every name already in
`out/components.json` (check against it), and stay lowercase, one to three words.

## 5. Component mnemonics: `compmn-NN.json`

Input: `{c, name, parts}`: a component, its picture name, and the named components it is
built from (`[glyph, name]`). Output `{"c": "半", "m": "…"}`: a mnemonic of 12 to 35
words that puts the parts together into the component's name, each part's name between
single asterisks exactly as given, and the component's own name between double
asterisks. Example: 半 half, from 丷 horns, 二 two, 丨 rod: "If you have *two* *horns* and
want to split them into **half**, all you need is a *rod* down the middle."

## 6. Character scenes: `scene-NN.json`

HanziHome now teaches a character the way a good memory palace does: its **sound** and
its **parts** in one absurd little scene. Each syllable is three pictures, from
`site/data/sounds.js`: the initial is a pop-culture FIGURE (b- Batman, sh- Sherlock, no
initial Casper), the final is a BUILDING (-an the Mansion, -ing the Boxing Ring) and
the tone is WHERE at that building (1 Front: in front of it, 2 Inside it, 3 its Basement,
4 its Bathroom, 5 on its Roof). Don't mention one of the other tone places in the scene.

Input: `{c, pin, key, sound, parts, old}`: the character, its reading, the meaning to
teach, `sound` as `["b- Batman", "-an Mansion", "4 Bathroom"]`, its components as
`[glyph, picture name]`, and the old, shorter mnemonic (ideas welcome, but rewrite).

Output: `{"c": "半", "m": "…"}`, where `m` is the scene:

* **40 to 80 words**, two to four sentences, present tense, vivid and absurd: something
  happens, with movement, noise, a surprise. Funny beats sensible; the stranger the
  image, the better it sticks. Nothing gory or sexual. The only famous names are the cast's fictional figures (section 7): no real people or brands.
* **Open with the sound**: the figure, at the tone's place, of the building, in the first
  sentence: "{Batman} glides into the {Bathroom} of the {Mansion} …". Write the
  three sound names between curly braces exactly as given (no "-an" or tone numbers),
  each once.
* **Use every component**, by its name exactly as given, between single asterisks
  (`*horns*`), as a thing in the scene that does something.
* **The meaning twice**: the `key` (or a plain form of it: halves, halved) between double
  asterisks, at least twice, and the scene should make the meaning *happen* (for 半
  Batman's batarang slices everything in the mansion in **half**), not just name it at the end.
* Example, 半 bàn "half", sound b- Batman, -an Mansion, 4 Bathroom, parts 半 half:
  "{Batman} glides into the {Bathroom} of the {Mansion} and hurls a
  batarang that slices everything into two *halves*: barrels, chairs, a grandfather
  clock. Alfred finds the wine rack cut clean in **half**, and Batman, brooding, growls
  that crime is now only **half** as bad."

## 7. The cast: scenes built on the figures

The initials were once jobs (the Baker, the Yogi). They are now figures a learner already
knows. **The scene is themed to its figure: the figure's defining powers, personality and
mechanics are how the meaning happens.** Gandalf is a wizard, so he gets there by magic;
Mario gets there by jumping on it and collecting the coin; Yoshi swallows it and lays it as
an egg; Sherlock deduces it; Charlie Brown has it go wrong for him. Someone who knows the
character should feel it could only be them. A figure merely standing in the scene while
something else happens is a failure, however funny.

| initial | figure | he/she | short name | defining powers, personality, mechanics |
|---|---|---|---|---|
| none | Casper | he | Casper | friendly ghost: floats through walls, turns invisible, frightens people by accident, only wants a friend |
| b | Batman | he | Batman | cape and glide, utility belt with a gadget for everything, batarangs, grappling hook, gruff voice, brooding, detective, Batmobile |
| p | Pikachu | he | Pikachu | small, yellow, cheek sparks, Thunderbolt, says only "Pika!", lives in a Poké Ball, gets caught |
| m | Mario | he | Mario | plumber, red cap, moustache, stomps on things, head-butts blocks for coins, mushrooms make him grow, warp pipes, "Wahoo!" |
| f | Frodo | he | Frodo | small hobbit, bare hairy feet, the Ring turns him invisible and tempts him, weary, reluctant, very long walks, loyal friend Sam |
| d | Darth Vader | he | Vader | black helmet, loud breathing, cape, Force-chokes objects only, lifts things with the Force, red lightsaber, booming disapproval, "I am your father" |
| t | Tarzan | he | Tarzan | swings on vines, loincloth, jungle yell, raised by apes, talks to animals, baffled by civilisation |
| n | Naruto | he | Naruto | orange jumpsuit, ninja, shadow clones by the dozen, spinning Rasengan, ramen, loud, never gives up, headband |
| l | Lara Croft | she | Lara | tomb raider, ponytail, acrobatic, ancient traps and rolling boulders, relics, puzzles, climbs anything (never shoots anyone) |
| g | Gandalf | he | Gandalf | wizard: grey robes, staff, pointy hat, spells, fireworks, "You shall not pass!", arrives exactly when he means to, pipe, wise and cranky |
| k | Kermit | he | Kermit | green frog, flailing arms, panicked "Yaaay!", banjo, hops, stage manager of chaos, "it's not easy being green" |
| h | Homer | he | Homer | bald, doughnuts, "D'oh!", lazy, naps at the nuclear plant, Duff-free: no beer, dim schemes that backfire, "Mmm…" |
| j | James Bond | he | Bond | tuxedo, gadgets from Q that do one absurd thing, unruffled one-liners, "Bond. James Bond.", shaken not stirred, escapes everything |
| q | Chewbacca | he | Chewbacca | huge, hairy, roars and growls that only friends understand, bandolier, crossbow, very loyal, rips things apart in a temper, fixes ships |
| x | Shrek | he | Shrek | green ogre, swamp, onions and layers, grumpy, wants to be left alone, roars, a donkey who will not shut up |
| zh | the Joker | he | the Joker | purple suit, green hair, huge grin, squirting flower, trick playing cards, cackling, everything is a prank (harmless pranks only) |
| ch | Charlie Brown | he | Charlie | zigzag shirt, bad luck, kites eaten by trees, the football pulled away, "Good grief", gloomy, never wins, dog Snoopy |
| sh | Sherlock | he | Sherlock | deerstalker, pipe, magnifying glass, deduces everything from one crumb, "Elementary", violin, smug, Watson trailing |
| r | Robocop | he | Robocop | steel armour, visor, stiff heavy walk, targeting display, reads out rules and directives, "Dead or alive" not used: arrests everything politely |
| z | Zorro | he | Zorro | black mask and cape, rapier, slashes a Z into anything, black horse, swings from chandeliers, dashing, vanishes laughing |
| c | Cookie Monster | he | Cookie Monster | blue, furry, googly eyes, devours everything in a spray of crumbs, "Me want cookie!", talks in "me" |
| s | Sailor Moon | she | Sailor Moon | long blonde pigtails, sailor uniform, moon wand, long sparkly transformation sequence, speech about justice, tiara thrown, clumsy, cries loudly, talking cat Luna |
| y | Yoshi | he | Yoshi | green dinosaur, long sticky tongue, swallows anything and lays it as an egg, flutter jump, carries Mario, "Yoshi!" |
| w | Walter White | he | Walter | bald chemistry teacher, glasses, goatee, black hat, beakers and school experiments, proud of his precise science, RV, "I am the one who knocks" (chemistry class only: never drugs or crime) |

Input is as in section 6, with `old` the present scene. Output `{"c": "半", "m": "…"}`, and
every rule of section 6 still holds. `old` was made by renaming a job, so treat it as a
source of ideas only: keep a joke when it suits the figure, and otherwise write afresh.

* The figure's token (`{Batman}`, and `The {Joker}` with its article) appears once, in the
  first sentence, with the building and tone tokens. Afterwards use the short name, plain.
* The way the **meaning** happens is one of the figure's own powers or habits from the table,
  or one you know well from the source: don't reach for the same one every time. Vary them
  across a batch; each character should have its own use of the figure.
* The old job goes: no baking Batman, no yoga for Yoshi, no juggling Bond. An old job word
  may stay only as something else in the scene (a pirate ship passing), never as the figure.
* Right pronouns for the figure, with other people's kept clear of it. Casper and Robocop
  are "he", not "it".
* Every *chip* still acts in the scene, every **meaning** still appears at least twice, and
  no other tone's place is mentioned.
* Clean and light, fit for any age. No quotation longer than a catchphrase. Other characters
  from the figure's world (Sam, Watson, Snoopy) may appear; figures from other rows may not.


## 8. Character scenes, round three: `scene2-NN.json`

Everything is new: the sound cast, many component names and the meanings. Write every
scene from scratch. Sections 6 and 7 still hold except where this section says otherwise.

**The sound.** A syllable is now a BEGINNING, an ENDING and a TONE:

* The beginning is the consonant *with the glide after it*: bàn is b- + -an, but biàn is
  bi- + -an, guì is gu- + -(e)i, nǚ is nü- + nothing. Each beginning is a famous FIGURE
  (table below).
* The ending is what is left, a BUILDING: -_ {Shed}, -a {Spa}, -o {Fort}, -e {Hut}, -ai {Island}, -(e)i {Lake}, -ao {Tower}, -(o)u {Boathouse}, -an {Mansion}, -(e)n {Funfair}, -ang {Hangar}, -(e)ng {Jungle}, -ong {Lagoon}, -er {Car Park}. The Shed is for syllables with
  nothing after the beginning (yī, wǔ, shì, bù, jí, nǚ).
* The tone is WHERE at that building, as before: 1 {Front}, 2 {Inside}, 3 {Basement},
  4 {Bathroom}, 5 {Roof}. Don't mention another tone's place in the scene.

**Input** `{c, pin, key, also, sound, parts}`: `key` is the meaning to teach, `also` the
character's other meanings (only for flavour; ignore it when it is noise), `sound` like
`["bu- Buddha", "-_ Shed", "4 Bathroom"]`, `parts` the components as `[glyph, picture name]`.
Many components were renamed: use the names exactly as given here, never older ones.
Some names are adjectives or directions (*white*, *heavy*, *up*): make them a thing in the
scene that is that (a *white* sheet, a *heavy* anvil, an arrow pointing *up*). A part
whose name is the key itself (人 person) is written once as the *part* and twice as **key**.

**Output** `{"c": "不", "m": "…"}`:

* 40 to 80 words, two to four sentences, present tense, vivid and absurd.
* The first sentence has the three sound tokens, each exactly once, in curly braces,
  spelt exactly as in `sound` without the "b-", "-an" or tone number: "{Buddha} sits in
  the {Bathroom} of the {Shed} …". No other curly-brace tokens at all. Afterwards call the
  figure by the short name in the table, plain.
* Every part, by its name, between single asterisks, as a thing that does something.
* The **key** (or a plain form of it) between double asterisks at least twice, and the
  scene makes the meaning *happen* through the figure's own powers or habits. For grammar
  words (of, the particle 了, to be) make an object or action that stands for it, and say
  the word plainly: "Yoda points: **one** finger, **one** plank".
* The figure is the star: someone who knows them should feel only they could do it. Vary
  which power you use across the batch.
* Real people in the cast (Madonna, Nadal, Shakira, Beyoncé, Muhammad Ali, Dua Lipa, Tupac,
  Usain Bolt, Michael Schumacher, RuPaul, Jim Carrey, Isaac Newton, Houdini, Charlie Chaplin)
  appear only doing what they are publicly famous for, in a warm and admiring way: no
  private life, health, politics, rivals or anything that mocks them. Religious figures
  (the Buddha, Noah, Shiva) stay dignified and kind: the absurdity happens around them.
  Lucifer is the cartoon devil, cheeky not evil. No figure from the old cast (Casper,
  Mario, Frodo, Tarzan, Naruto, Gandalf, Kermit, James Bond, Shrek, Charlie Brown,
  Sherlock, Robocop, Sailor Moon, Yoshi, Walter White) and no figure from another row.
* Clean, light, fit for any age; nothing gory, sexual or mean; no brands beyond the
  figures' own world; no quotation longer than a catchphrase.

Example, 不 bù "not", sound bu- Buddha, -_ Shed, 4 Bathroom, part 不 *no sign*:
"{Buddha} sits calmly in the {Bathroom} of the {Shed} while a crowd pounds on the door.
He simply hangs a *no sign* on the handle. **Not** now, **not** today, **not** ever:
the door stays shut and he keeps smiling, perfectly at peace."

| beginning | token | pronoun | short name | what they do |
|---|---|---|---|---|
| _- | {Invisible Man} | he | the Invisible Man | unseen except for his bandages, coat, hat and dark glasses; things float and move by themselves around him; unwraps to vanish; startles people; leaves footprints only |
| b- | {Batman} | he | Batman | cape and glide, utility belt with a gadget for everything, batarangs, grappling hook, gruff voice, brooding detective, Batmobile, butler Alfred |
| p- | {Pac-Man} | he | Pac-Man | yellow circle, mouth that chomps "waka waka" through rows of dots, eats power pellets, chased by four ghosts, races through mazes, wraps round the edge of the screen |
| m- | {Madonna} | she | Madonna | pop queen: reinvents her look every time, cone outfits, strikes a pose ("Vogue"), headset microphone, huge stage shows, dancers |
| f- | {Fred Flintstone} | he | Fred | caveman, stone-age car powered by his feet, "Yabba dabba doo!", quarry, dinosaur crane, pet dinosaur Dino, bowling, loud and hasty |
| d- | {Darth Vader} | he | Vader | black helmet, loud breathing, cape, lifts and squeezes objects with the Force, red lightsaber, booming disapproval, "I am your father" |
| t- | {Tony Stark} | he | Tony | Iron Man suit that flies with hand and boot jets, repulsor blasts, builds any gadget in minutes, AI butler JARVIS, show-off, quips, glowing chest reactor |
| n- | {Nadal} | he | Nadal | tennis: thundering topspin forehand, sleeveless shirt, headband, tidies his water bottles just so, tugs his shorts before each serve, bites the trophy, king of clay courts, never gives up a point |
| l- | {Lara Croft} | she | Lara | tomb raider, ponytail, acrobatic, ancient traps and rolling boulders, relics, puzzles, climbs anything (never shoots anyone) |
| g- | {Garfield} | he | Garfield | fat orange cat, lasagne, hates Mondays, naps everywhere, lazy, sarcastic, kicks Odie the dog off the table |
| k- | {King Kong} | he | Kong | giant ape, beats his chest and roars, climbs skyscrapers, swats biplanes, carries people gently in his huge hand |
| h- | {Homer Simpson} | he | Homer | bald, doughnuts, "D'oh!", lazy, naps at the nuclear plant, dim schemes that backfire, "Mmm…", strangles nobody (no Bart-choking), no beer |
| zh- | {Joker} | he | the Joker | purple suit, green hair, huge grin, squirting flower, trick playing cards, cackling, everything is a prank (harmless pranks only) |
| ch- | {Charlie Chaplin} | he | Chaplin | silent-film tramp: bowler hat, cane, toothbrush moustache, baggy trousers, waddle, slapstick tumbles, never speaks, mimes everything |
| sh- | {Shakira} | she | Shakira | pop star: hips that don't lie, belly dancing, long curly hair, "Waka Waka" football song, sings on any stage |
| r- | {Rocky} | he | Rocky | boxer Rocky Balboa: punches sides of meat, runs up long stairs and raises his fists, trains with raw eggs, the training music, "Adrian!", never stays down |
| z- | {Zorro} | he | Zorro | black mask and cape, rapier, slashes a Z into anything, black horse, swings from chandeliers, dashing, vanishes laughing |
| c- | {Cookie Monster} | he | Cookie Monster | blue, furry, googly eyes, devours everything in a spray of crumbs, "Me want cookie!", talks in "me" |
| s- | {Sonic} | he | Sonic | blue hedgehog, runs faster than sound, spins into a ball, collects gold rings and drops them all when hit, loops, taps his foot when kept waiting |
| y- | {Yoda} | he | Yoda | tiny green Jedi master, backwards speech ("Strong with the Force, you are"), walking stick, lifts things with the Force, swamp hut, 900 years old, surprising sword flips |
| w- | {Wonder Woman} | she | Wonder Woman | Amazon warrior: golden lasso that makes anyone tell the truth, bullet-deflecting bracelets, tiara, shield, invisible jet, super strength |
| bi- | {Beyoncé} | she | Beyoncé | pop queen: wind machine blowing her hair, powerful voice, perfect dance routines, "Single Ladies" hand wave, lemonade, fans called the Beyhive |
| bu- | {Buddha} | he | the Buddha | sits calmly cross-legged under a tree, peaceful smile, meditates through any chaos, kind teaching, lotus flower (always respectful: he stays serene, the chaos happens around him) |
| pi- | {Pikachu} | he | Pikachu | small, yellow, cheek sparks, Thunderbolt, says only "Pika!", lives in a Poké Ball, gets caught |
| pu- | {Winnie the Pooh} | he | Pooh | small honey-loving bear, head stuck in honey pots, "oh bother", friends Piglet and Tigger, gentle and muddled, stuck in a rabbit hole |
| mi- | {Mr. Bean} | he | Mr. Bean | silent, rubbery face, tweed jacket, tiny green car, teddy bear, solves small problems in absurd sneaky ways, makes a mess of everything |
| mu- | {Muhammad Ali} | he | Ali | boxing champion: "float like a butterfly, sting like a bee", fast footwork and shuffle, rhyming boasts, "I am the greatest" |
| fu- | {Nick Fury} | he | Fury | S.H.I.E.L.D. boss: eyepatch, long black coat, flying helicarrier, assembles teams of heroes, stern orders, knows every secret |
| di- | {Deadpool} | he | Deadpool | red suit and mask, two katanas, talks to the audience, never stops joking, heals from anything instantly, loves chimichangas (no gore) |
| du- | {Dua Lipa} | she | Dua Lipa | pop star: disco dance-floor songs, "New Rules" counted on her fingers, glitter, levitating on stage, roller skates, cool and composed |
| ti- | {Tinker Bell} | she | Tinker Bell | tiny fairy, pixie dust that makes things fly, jingles like a bell, jealous and fiery, glows brighter when cross, mends pots, friend Peter Pan |
| tu- | {Tupac} | he | Tupac | rap legend: bandana, rhymes for everything, poet, microphone, freestyles a verse about whatever happens, calm cool stare (no crime or violence) |
| ni- | {Nemo} | he | Nemo | small clownfish with one little fin, lost and found, dentist's fish tank, swims with turtles and forgetful Dory, lives in a sea anemone |
| nu- | {Noah} | he | Noah | long white beard, builds a huge wooden ark, loads every animal two by two, rain and floodwater, dove with an olive branch (always respectful and gentle) |
| nü- | {Isaac Newton} | he | Newton | scientist in a long curly wig: an apple falls on his head and he discovers gravity, prisms split light into rainbows, laws of motion, telescope, everything falls when he thinks of it |
| li- | {Lisa Simpson} | she | Lisa | clever girl with a spiky head, saxophone solos, straight A grades, vegetarian, protests and petitions, wise beyond her years, sighs at Bart |
| lu- | {Luigi} | he | Luigi | tall plumber in green, moustache, high wobbly jump, scared of ghosts, vacuums them up with his ghost hoover, always in his brother's shadow |
| lü- | {Lucifer} | he | Lucifer | charming devil (the comic kind): red horns and tail, pitchfork, little puffs of fire and smoke, makes cheeky deals, sulks when ignored |
| gu- | {Gru} | he | Gru | bald supervillain turned dad: long scarf, freeze ray, shrink ray, hundreds of yellow Minions who mess everything up, plans to steal the moon |
| ku- | {Kung Fu Panda} | he | Po | big clumsy panda, kung fu master, dumplings, noodle shop, belly bounces, "Skadoosh!", Furious Five friends, wise turtle Oogway |
| hu- | {Houdini} | he | Houdini | escape artist: breaks out of chains, locks, handcuffs, straitjackets and water tanks, vanishes elephants, magic tricks, ta-da! |
| ji- | {Jim Carrey} | he | Jim Carrey | rubber-faced comic actor: the Mask's green face and zoot suit, "Smokin'!", "Alrighty then!", pulls impossible faces, pulls impossible faces, mimics anyone, slapstick pratfalls |
| ju- | {Juliet} | she | Juliet | Shakespeare's romantic heroine: balcony, "Wherefore art thou Romeo?", love letters, sighs, swoons, roses, feuding families (no deaths) |
| qi- | {Chip} | he | Chip | little chipmunk of Chip 'n Dale: stuffs his cheeks with acorns, squeaky voice, scampers up trees, steals food with brother Dale, outwits big Donald Duck |
| qu- | {Chupacabra} | it | the Chupacabra | legendary spiky-backed goat-sucker of the night: glowing red eyes, sneaks round farms, nobody ever gets a good photo, hisses, (silly not scary: it only sips milk) |
| xi- | {Shiva} | he | Shiva | Hindu god of dance: four arms, cosmic dance in a ring of fire, third eye, trident, snake around his neck, blue throat, drum (always respectful and majestic) |
| xu- | {Michael Schumacher} | he | Schumacher | Formula One champion: red racing car, pit stops in two seconds, champagne spray on the podium, helmet and race suit, overtakes everything |
| zhu- | {Judy Hopps} | she | Judy | rabbit police officer from Zootopia: badge, carrot pen recorder, writes parking tickets at top speed, hops high, optimistic, sly fox partner Nick |
| chu- | {Chewbacca} | he | Chewbacca | huge, hairy, roars and growls that only friends understand, bandolier, crossbow, very loyal, rips things apart in a temper, fixes ships |
| shu- | {Shuri} | she | Shuri | princess and genius inventor of Wakanda: vibranium gadgets, sonic gauntlets, holograms, makes everything high-tech, teases her big brother |
| ru- | {RuPaul} | she | RuPaul | drag superstar: towering wig, sequinned gown, catwalk, "Sashay away!", "Good luck, and don't mess it up!", makeover of anything |
| zu- | {Zoolander} | he | Zoolander | vain male model: the "Blue Steel" pout, can't turn left, catwalk walk-off, really, really ridiculously good-looking, not very bright |
| cu- | {Cuphead} | he | Cuphead | cartoon cup with a straw in his head, 1930s rubber-hose style, finger-gun blasts, dashes and parries pink things, fights giant bosses with brother Mugman |
| su- | {Dr. Seuss} | he | Dr. Seuss | author of rhyming picture books: Cat in the Hat, green eggs and ham, wobbly towers of things, everything said in bouncy rhyme, invents silly creatures |
| yu- | {Usain Bolt} | he | Bolt | fastest sprinter alive: the lightning-bolt pose, crosses the line first, gold medals, a blur on the track, dances before races |

Settled questions:

* A key or part name that is itself a place word (里 inside, 前 front, 宀 *roof*) may be
  used even when it clashes with the tone: keep it inside its asterisks.
* The **key** two or three times, not more: repeating it five times is padding. Simple
  inflections are fine (go, goes, going).
* The *parts* should help the meaning happen, not just stand around.
* Lake and Boathouse read oddly as rooms: "the {Bathroom} of the {Lake} cabin" is fine.
* No parts in the input: write the scene without any.

Check each file you write: `node build/mnemonics/check.js scene2-NN` must print "ok".


## 9. Renamed components: `compren.json`

Some components got new picture names (section 8 uses them). Input `{c, name, old, meaning,
parts, why, m, task}`: the component, its new `name`, its `old` name, its dictionary
meaning, its parts as `[glyph, picture name]` (new names), its present look note `why`
and its present story `m`.

Output `{"c": "白", "why": "…", "m": "…"}`:

* `task: "rename"`: write a new `why`, one short sentence (at most 20 words) on how the
  shape shows the new name, or for an adjective or direction name, that the component
  means it ("The sun with a ray of light on top: everything it touches turns white.").
  Write a new story `m`, at most 40 words: every part by its name in single asterisks,
  building up to the new name in double asterisks (`**white**`). Keep any good idea of the
  old story that still fits; drop the old name entirely.
* `task: "story"`: the component kept its name, but its story names a part whose name
  changed. Keep `why` exactly as it is, and rewrite `m` as little as needed so every part
  appears by its new name, and the story still builds to **its own name**.
* Every *part* name exactly as given in `parts` (a plural is fine). No real people.
