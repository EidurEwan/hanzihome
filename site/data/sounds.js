/* HanziHome's sound cast (build/mnemonics/cast2.js): every Mandarin syllable is a
 * BEGINNING, an ENDING and a TONE, and each gets a picture, so a mnemonic can carry the sound:
 * the beginning (the consonant with any glide after it: b-, bi-, bu-, nü-) is a famous FIGURE,
 * the ending (what is left, or nothing: the Shed) a BUILDING, the tone WHERE at that building:
 * 1 in Front of it, 2 Inside it, 3 its Basement, 4 its Bathroom, 5 on its Roof.
 * 半 bàn is Batman (b-) at the Mansion (-an), in its Bathroom (4); 变 biàn is Beyoncé (bi-).
 * Keys as Learn.soundOf() gives them: ü is v (nv: nü-), "" is no beginning or no ending.
 * initials/finals: [name, why it fits, label]. The keys keep their old names, initials
 * and finals, though the app calls them beginnings and endings. */
HZ.sounds = {
 "initials": {
  "": [
   "Invisible Man",
   "No beginning sound: nobody there but the Invisible Man.",
   "_"
  ],
  "b": [
   "Batman",
   "b as in Batman.",
   "b"
  ],
  "p": [
   "Pac-Man",
   "p as in Pac-Man.",
   "p"
  ],
  "m": [
   "Madonna",
   "m as in Madonna.",
   "m"
  ],
  "f": [
   "Fred Flintstone",
   "f as in Fred Flintstone.",
   "f"
  ],
  "d": [
   "Darth Vader",
   "d as in Darth Vader.",
   "d"
  ],
  "t": [
   "Tony Stark",
   "t as in Tony Stark, Iron Man.",
   "t"
  ],
  "n": [
   "Nadal",
   "n as in Rafael Nadal, the tennis star.",
   "n"
  ],
  "l": [
   "Lara Croft",
   "l as in Lara Croft.",
   "l"
  ],
  "g": [
   "Garfield",
   "g as in Garfield.",
   "g"
  ],
  "k": [
   "King Kong",
   "k as in King Kong.",
   "k"
  ],
  "h": [
   "Homer Simpson",
   "h as in Homer Simpson.",
   "h"
  ],
  "zh": [
   "Joker",
   "zh sounds like the j of Joker, the tongue curled back.",
   "zh"
  ],
  "ch": [
   "Charlie Chaplin",
   "ch as in Charlie Chaplin, the tongue curled back, with a puff of air.",
   "ch"
  ],
  "sh": [
   "Shakira",
   "sh as in Shakira, the tongue curled back.",
   "sh"
  ],
  "r": [
   "Rocky",
   "r as in Rocky, the tongue curled back.",
   "r"
  ],
  "z": [
   "Zorro",
   "z as in Zorro, but softer: the ds at the end of \"kids\".",
   "z"
  ],
  "c": [
   "Cookie Monster",
   "c sounds like the ts of \"eats\", which is all Cookie Monster does, with a puff of air.",
   "c"
  ],
  "s": [
   "Sonic",
   "s as in Sonic the Hedgehog.",
   "s"
  ],
  "y": [
   "Yoda",
   "y as in Yoda.",
   "y"
  ],
  "w": [
   "Wonder Woman",
   "w as in Wonder Woman.",
   "w"
  ],
  "bi": [
   "Beyoncé",
   "bi- as in Beyoncé.",
   "bi"
  ],
  "bu": [
   "Buddha",
   "bu- as in Buddha.",
   "bu"
  ],
  "pi": [
   "Pikachu",
   "pi- as in Pikachu.",
   "pi"
  ],
  "pu": [
   "Winnie the Pooh",
   "pu- as in Pooh.",
   "pu"
  ],
  "mi": [
   "Mr. Bean",
   "mi- as in Mister Bean.",
   "mi"
  ],
  "mu": [
   "Muhammad Ali",
   "mu- as in Muhammad.",
   "mu"
  ],
  "fu": [
   "Nick Fury",
   "fu- as in Fury.",
   "fu"
  ],
  "di": [
   "Deadpool",
   "di- as in Deadpool.",
   "di"
  ],
  "du": [
   "Dua Lipa",
   "du- as in Dua Lipa.",
   "du"
  ],
  "ti": [
   "Tinker Bell",
   "ti- as in Tinker Bell.",
   "ti"
  ],
  "tu": [
   "Tupac",
   "tu- as in Tupac.",
   "tu"
  ],
  "ni": [
   "Nemo",
   "ni- as in Nemo.",
   "ni"
  ],
  "nu": [
   "Noah",
   "nu- as in Noah.",
   "nu"
  ],
  "nv": [
   "Isaac Newton",
   "nü- sounds like the \"new\" of Newton, the lips rounded.",
   "nü"
  ],
  "li": [
   "Lisa Simpson",
   "li- as in Lisa.",
   "li"
  ],
  "lu": [
   "Luigi",
   "lu- as in Luigi.",
   "lu"
  ],
  "lv": [
   "Lucifer",
   "lü- sounds like the \"loo\" of Lucifer, the lips rounded.",
   "lü"
  ],
  "gu": [
   "Gru",
   "gu- as in Gru.",
   "gu"
  ],
  "ku": [
   "Kung Fu Panda",
   "ku- as in Kung Fu Panda.",
   "ku"
  ],
  "hu": [
   "Houdini",
   "hu- as in Houdini.",
   "hu"
  ],
  "ji": [
   "Jim Carrey",
   "ji- as in Jim.",
   "ji"
  ],
  "ju": [
   "Juliet",
   "ju- sounds like the \"Ju\" of Juliet, the lips rounded.",
   "ju"
  ],
  "qi": [
   "Chip",
   "qi- sounds like the \"chi\" of Chip, with a puff of air.",
   "qi"
  ],
  "qu": [
   "Chupacabra",
   "qu- sounds like the \"Chu\" of Chupacabra, the lips rounded.",
   "qu"
  ],
  "xi": [
   "Shiva",
   "xi- sounds like the \"Shi\" of Shiva, said with a smile.",
   "xi"
  ],
  "xu": [
   "Michael Schumacher",
   "xu- sounds like the \"Schu\" of Schumacher, said with rounded lips.",
   "xu"
  ],
  "zhu": [
   "Judy Hopps",
   "zhu- sounds like the \"Ju\" of Judy, the tongue curled back.",
   "zhu"
  ],
  "chu": [
   "Chewbacca",
   "chu- as in Chewbacca, the tongue curled back.",
   "chu"
  ],
  "shu": [
   "Shuri",
   "shu- as in Shuri, the tongue curled back.",
   "shu"
  ],
  "ru": [
   "RuPaul",
   "ru- as in RuPaul.",
   "ru"
  ],
  "zu": [
   "Zoolander",
   "zu- sounds like the \"Zoo\" of Zoolander, said softer.",
   "zu"
  ],
  "cu": [
   "Cuphead",
   "cu- sounds like a soft \"tsu\", the Cup of Cuphead.",
   "cu"
  ],
  "su": [
   "Dr. Seuss",
   "su- as in Seuss.",
   "su"
  ],
  "yu": [
   "Usain Bolt",
   "yu- sounds like the \"U\" of Usain, the lips rounded.",
   "yu"
  ]
 },
 "finals": {
  "": [
   "Shed",
   "No ending: the syllable stops after its beginning (yi, wu, zhi, bu, ji, nü), like an empty Shed.",
   "-_"
  ],
  "a": [
   "Spa",
   "-a sounds like the \"ah\" of a relaxing Spa.",
   "-a"
  ],
  "o": [
   "Fort",
   "-o sounds like the \"aw\" of Fort.",
   "-o"
  ],
  "e": [
   "Hut",
   "-e sounds like the \"uh\" of Hut (after i- or ü-: the \"eh\" of yeti).",
   "-e"
  ],
  "ai": [
   "Island",
   "-ai sounds like the \"eye\" of Island.",
   "-ai"
  ],
  "ei": [
   "Lake",
   "-(e)i sounds like the \"ay\" of Lake: -ei, and the -i of gui, dui.",
   "-(e)i"
  ],
  "ao": [
   "Tower",
   "-ao sounds like the \"ow\" of Tower.",
   "-ao"
  ],
  "ou": [
   "Boathouse",
   "-(o)u sounds like the \"oh\" of Boathouse: -ou, and the -u of jiu, liu.",
   "-(o)u"
  ],
  "an": [
   "Mansion",
   "-an sounds like the \"ahn\" of Mansion.",
   "-an"
  ],
  "en": [
   "Funfair",
   "-(e)n sounds like the \"un\" of Funfair: -en, and the -n of jin, lun, jun.",
   "-(e)n"
  ],
  "ang": [
   "Hangar",
   "-ang sounds like the \"ahng\" of Hangar.",
   "-ang"
  ],
  "eng": [
   "Jungle",
   "-(e)ng sounds like the \"ung\" of Jungle: -eng, and the -ng of jing.",
   "-(e)ng"
  ],
  "ong": [
   "Lagoon",
   "-ong sounds like the \"oong\" of Lagoon.",
   "-ong"
  ],
  "er": [
   "Car Park",
   "er sounds like the \"ar\" of Car Park, the tongue curled back.",
   "-er"
  ]
 },
 "tones": {
  "1": [
   "Front",
   "First tone: the scene happens in front of the building."
  ],
  "2": [
   "Inside",
   "Second tone: the scene happens inside the building."
  ],
  "3": [
   "Basement",
   "Third tone: the scene happens in the basement of the building."
  ],
  "4": [
   "Bathroom",
   "Fourth tone: the scene happens in the bathroom of the building."
  ],
  "5": [
   "Roof",
   "Fifth (neutral) tone: the scene happens on the roof of the building."
  ]
 },
 "heard": {
  "initials": {
   "": "a",
   "b": "bo",
   "p": "po",
   "m": "mo",
   "f": "fo",
   "d": "de",
   "t": "te",
   "n": "ne",
   "l": "le",
   "g": "ge",
   "k": "ke",
   "h": "he",
   "zh": "zhi",
   "ch": "chi",
   "sh": "shi",
   "r": "ri",
   "z": "zi",
   "c": "ci",
   "s": "si",
   "y": "ya",
   "w": "wa",
   "bi": "bi",
   "bu": "bu",
   "pi": "pi",
   "pu": "pu",
   "mi": "mi",
   "mu": "mu",
   "fu": "fu",
   "di": "di",
   "du": "du",
   "ti": "ti",
   "tu": "tu",
   "ni": "ni",
   "nu": "nu",
   "nv": "nv",
   "li": "li",
   "lu": "lu",
   "lv": "lv",
   "gu": "gu",
   "ku": "ku",
   "hu": "hu",
   "ji": "ji",
   "ju": "ju",
   "qi": "qi",
   "qu": "qu",
   "xi": "xi",
   "xu": "xu",
   "zhu": "zhu",
   "chu": "chu",
   "shu": "shu",
   "ru": "ru",
   "zu": "zu",
   "cu": "cu",
   "su": "su",
   "yu": "yu"
  },
  "finals": {
   "": "",
   "a": "a",
   "o": "o",
   "e": "e",
   "ai": "ai",
   "ei": "ei",
   "ao": "ao",
   "ou": "ou",
   "an": "an",
   "en": "en",
   "ang": "ang",
   "eng": "eng",
   "ong": "dong",
   "er": "er"
  }
 }
};
