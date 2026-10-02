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
