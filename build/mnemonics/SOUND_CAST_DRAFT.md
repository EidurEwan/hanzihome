# Sound cast draft (not wired into the app)

A proposed replacement for `site/data/sounds.js`. It uses the 74 sound parts from the
reference deck: 55 beginnings (some include the glide i/u/ü), 14 endings and 5 tones.
None of the names are taken from that deck. Nothing in `site/` uses this file yet.

## How a syllable splits

- Where the beginning takes a glide, the glide belongs to the beginning: **xiān** = xi- + -an,
  **guì** = gu- + -(e)i, **jiǔ** = ji- + -(o)u, **yuǎn** = yu- + -an, **nüè** = nü- + -e.
- j, q and x never stand alone: they are always ji-/qi-/xi- or ju-/qu-/xu-.
- yi, wu and the buzzing zhi chi shi ri zi ci si take the empty ending (-_):
  **yī** = y- + -_, **wǔ** = w- + -_, **shì** = sh- + -_.
- The bracketed letter drops after a glide: -(e)n is **ben** or **bin**, -(e)ng is **beng** or
  **bing**, -(e)i is **bei** or **gui**, -(o)u is **dou** or **jiu**.
- With no beginning at all, the syllable takes `_-` (**ài** = _- + -ai, **ér** = _- + -er).

## Beginnings: figures (55)

The name starts with (or sounds like) the beginning. Names marked *kept* are already in the app.

| Sound | Figure | | Sound | Figure |
|---|---|---|---|---|
| _- | The Invisible Man (no one there) | | b- | Batman *kept* |
| p- | Pac-Man | | m- | Madonna |
| f- | Fred Flintstone | | d- | Darth Vader *kept* |
| t- | Tony Stark (Iron Man) | | n- | Rafael Nadal |
| l- | Lara Croft *kept* | | g- | Garfield |
| k- | King Kong | | h- | Homer Simpson *kept* |
| zh- | Joker *kept* | | ch- | Charlie Chaplin |
| sh- | Shakira | | r- | Rocky |
| z- | Zorro *kept* | | c- | Cookie Monster *kept* |
| s- | Sonic | | y- | Yoda |
| w- | Wonder Woman | | | |
| bi- | Beyoncé | | bu- | Buddha |
| pi- | Pikachu *(was p-)* | | pu- | Winnie the Pooh |
| mi- | Mr. Bean | | mu- | Muhammad Ali |
| fu- | Nick Fury | | | |
| di- | Deadpool | | du- | Dua Lipa |
| ti- | Tinker Bell | | tu- | Tupac |
| ni- | Nemo | | nu- | Noah (and his ark) |
| nü- | Isaac Newton | | | |
| li- | Lisa Simpson | | lu- | Luigi |
| lü- | Lucifer | | | |
| gu- | Gru (Despicable Me) | | ku- | Kung Fu Panda |
| hu- | Houdini | | | |
| ji- | Jim Carrey | | ju- | Juliet (Romeo and Juliet) |
| qi- | Chip (Chip 'n Dale) | | qu- | Chupacabra |
| xi- | Shiva | | xu- | Michael Schumacher |
| zhu- | Judy Hopps (Zootopia) | | chu- | Chewbacca *(was q-)* |
| shu- | Shuri (Black Panther) | | ru- | RuPaul |
| zu- | Zoolander | | cu- | Cuphead |
| su- | Dr. Seuss | | yu- | Usain Bolt |

## Endings: buildings (14)

| Sound | Building | Why |
|---|---|---|
| -_ | Shed *(new)* | Nothing added: a bare shed |
| -a | Spa *kept* | the "ah" of Spa |
| -o | Fort *kept* | the "aw" of Fort |
| -e | Hut *kept* | the "uh" of Hut (after a glide: "eh") |
| -ai | Island *kept* | the "eye" of Island |
| -(e)i | Lake *kept* | the "ay" of Lake |
| -ao | Tower *kept* | the "ow" of Tower |
| -(o)u | Boathouse *kept* | the "oh" of Boathouse |
| -an | Mansion *kept* | the "ahn" of Mansion |
| -(e)n | Funfair *kept* | the "un" of Funfair |
| -ang | Hangar *kept* | the "ahng" of Hangar |
| -(e)ng | Jungle *kept* | the "ung" of Jungle |
| -ong | Lagoon *kept* | the "oong" of Lagoon |
| -er | Car Park *kept* | the "ar" of Car Park |

The app's other 23 endings (Beach, Beehive, Piazza, Yeti Cave, Pool, Museum and so on)
would go: their glide now lives in the beginning.

## Tones: where at the building (5, unchanged)

1 Front · 2 Inside · 3 Basement · 4 Bathroom · 5 Roof

## Examples

- 半 bàn: Batman (b-) at the Mansion (-an), in its Bathroom (4)
- 学 xué: Michael Schumacher (xu-) at the Hut (-e), Inside (2)
- 家 jiā: Jim Carrey (ji-) at the Spa (-a), in Front (1)
- 水 shuǐ: Shuri (shu-) at the Lake (-(e)i), in the Basement (3)
- 是 shì: Shakira (sh-) at the Shed (-_), in the Bathroom (4)
- 远 yuǎn: Usain Bolt (yu-) at the Mansion (-an), in the Basement (3)

## What switching the app over would take (later)

1. Rewrite `HZ.sounds` in `site/data/sounds.js` with these keys and a new `heard` table.
2. Change `Learn.soundOf()` in `site/learn.js` to split syllables this way.
3. Rerun the scene scripts in `build/mnemonics/` so every character scene names the new
   figure and building, then update `test/sounds.js`.
