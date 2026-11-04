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
