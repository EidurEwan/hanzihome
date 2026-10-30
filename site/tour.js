/* tour.js — the tutorials: a few slides each, in a dialog.
 *
 * intro: how learning Mandarin works and how HanziHome teaches it. It opens by
 * itself once, on a newcomer's first visit (nothing in their lessons, nothing
 * marked); someone who already has progress here never gets it unasked. Whether it
 * has been seen is kept on this device only (localStorage).
 * sync: setting up sync with a Google Sheet, step by step.
 * api: getting a free Google AI Studio key for the translator, and adding it.
 *
 * Settings → Tutorials opens any of them; the sync and translator cards have a
 * "show me how" for theirs (any element with data-guide="sync" or "api"). Needs
 * Store and Motion. */

'use strict';

const TOUR_KEY = 'hanzihome.tour';

const TOUR_INTRO = [
  {
    art: '<div class="tu-tiles"><b>汉</b><b>字</b></div>',
    title: 'Welcome to HanziHome',
    body: `<p>A home for learning Chinese characters: lessons, reviews, a reader and a translator, all in your
      browser. Here is how learning Mandarin works, and how this app helps, in under a minute.</p>`,
  },
  {
    art: '<div class="tu-tiles"><b>好</b><em>=</em><b class="comp">女</b><em>+</em><b class="comp">子</b></div>',
    title: 'Characters are built from parts',
    body: `<p>Most characters are a few <b>components</b> put together: 好 <i>good</i> is 女 <i>woman</i> + 子
      <i>child</i>. Learn the parts and new characters stop being random strokes.</p>
      <p>You don't need them all: about 1,000 common characters cover roughly 90% of everyday text.</p>`,
  },
  {
    art: `<div class="tu-tiles tu-tones"><b class="sound"><span>妈</span>mā</b><b class="sound"><span>麻</span>má</b>
      <b class="sound"><span>马</span>mǎ</b><b class="sound"><span>骂</span>mà</b></div>`,
    title: 'Every syllable has a tone',
    body: `<p>Mandarin has four tones and a neutral one, and the tone changes the word: mā is <i>mother</i>, mǎ is
      <i>horse</i>. <b>Pinyin</b> writes the sounds in letters. In reviews you type it with tone numbers: ma3.</p>`,
  },
  {
    art: `<div class="tu-tiles tu-path"><b class="sound">mù</b><em>→</em><b class="comp">木</b><em>→</em><b>林</b><em>→</em>
      <b class="word">树林</b></div>`,
    title: 'Lessons, then reviews',
    body: `<p><b>Lessons</b> teach a few new items at a time: sounds and components first, then the characters made
      of them, then words. Each lesson ends with a short quiz.</p>
      <p>After that, everything you learned comes back in <b>reviews</b>, where you type its meaning and its pinyin.</p>`,
  },
  {
    art: `<div class="tu-bars">${[[1, 'Today'], [0.55, 'Tomorrow'], [0.3, 'In 3 days'], [0.15, 'In a week'], [0.07, 'In a month']]
      .map(([w, d]) => `<div><span>${d}</span><i style="width:${w * 100}%"></i></div>`).join('')}</div>`,
    title: 'Reviews come just before you forget',
    body: `<p>Each review is scheduled by FSRS, a model of memory. Something you know well waits weeks before it
      comes back; something you keep missing comes back tomorrow. The gaps grow as you remember.</p>
      <p>Answer honestly: it learns how <i>your</i> memory works.</p>`,
  },
  {
    art: '<div class="tu-goal"><img src="img/flame.svg" alt=""><b>20–30</b><span>minutes a day</span></div>',
    title: 'Consistency is key',
    body: `<p>Twenty to thirty minutes <b>every day</b> beats three hours at the weekend. Memory is built by coming
      back, little and often.</p>
      <p>Do your reviews first, then lessons if you have time. Skipped days pile reviews up; a daily habit keeps
      them light. Going away? Settings has a vacation mode that pauses everything.</p>`,
  },
  {
    art: `<div class="tu-read"><span>我</span><span>想</span><span class="on">学习</span><span>中文</span>
      <div class="tu-pop"><b>学习</b> xuéxí<br><small>to study, to learn</small></div></div>`,
    title: 'Read, look up, translate',
    body: `<p>Paste any Chinese into the <b>Reader</b> and point at (or tap) a word for its meaning; add it to your
      lessons from there. The <b>Translator</b> turns English, pinyin or characters into word cards and explains the
      grammar. The <b>Words</b> and character pages are a dictionary with stroke order.</p>
      <p>Settings has short guides for syncing your progress between devices and for adding a free translator key.</p>`,
  },
  {
    art: '<div class="tu-tiles"><b class="word">加油</b></div>',
    title: 'Ready?',
    body: `<p>Start with your first lessons: a handful of sounds, components and characters. Come back tomorrow for
      their first reviews. 加油 <i>jiāyóu</i>: you can do it!</p>`,
    last: true,
  },
];

const SYNC_SCRIPT = 'https://raw.githubusercontent.com/EidurEwan/hanzihome/main/sync/Code.gs';
const SYNC_SCRIPT_PAGE = 'https://github.com/EidurEwan/hanzihome/blob/main/sync/Code.gs';

/* little pictures of the screens the steps happen on */
const mock = (title, body) => `<div class="tu-win"><div class="tu-bar"><i></i><i></i><i></i><span>${title}</span></div>${body}</div>`;

const TOUR_SYNC = [
  {
    art: `<div class="tu-devices"><span class="tu-dev phone">字</span><span class="tu-link"></span>
      <span class="tu-dev sheet"><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="tu-link"></span>
      <span class="tu-dev laptop">字</span></div>`,
    title: 'Sync your progress',
    body: `<p>Sync keeps your lessons, reviews, marked characters, lists and notes the same on every device: your phone,
      laptop and the desktop app.</p>
      <p>It is free and private: your progress is saved in a <b>Google Sheet you own</b>, through a small script in your
      own Google account. Setting it up takes about 5 minutes, once. After that each device only needs a link.</p>`,
  },
  {
    art: mock('sheets.new', `<div class="tu-menu"><b>Extensions</b><span class="on">Apps Script</span><span>Add-ons</span></div>
      <div class="tu-grid">${'<i></i>'.repeat(12)}</div>`),
    title: '1. Make a Google Sheet',
    body: `<p>Open a new, empty Google Sheet (sign in to Google if it asks) and name it, for example
      <i>HanziHome</i>.</p>
      <p>Then, in the Sheet's menu, choose <b>Extensions → Apps Script</b>. A script editor opens in a new tab.</p>
      <p><a class="btn" href="https://sheets.new" target="_blank" rel="noopener">Open a new Sheet</a></p>`,
  },
  {
    art: mock('Apps Script · Code.gs', `<div class="tu-code"><span class="k">/** HanziHome sync */</span><span>function doGet(e) {</span>
      <span>&nbsp;&nbsp;…</span><span>}</span></div>`),
    title: '2. Paste in the script',
    body: `<p>Copy HanziHome's sync script, then in the editor select everything in <b>Code.gs</b>, delete it, and
      paste the script in its place. Save with <b>Ctrl+S</b> (<b>⌘S</b> on a Mac) or the disk icon.</p>
      <p class="row"><button class="btn" data-tour-act="copy-script">Copy the script</button>
        <a class="small" href="${SYNC_SCRIPT_PAGE}" target="_blank" rel="noopener">or open it on GitHub</a></p>
      <p class="small tour-note" id="tour-copied" aria-live="polite"></p>`,
  },
  {
    art: mock('Deploy → New deployment', `<div class="tu-form"><span>Type <b>Web app ⚙</b></span>
      <span>Execute as <b>Me</b></span><span>Who has access <b>Anyone</b></span><em>Deploy</em></div>`),
    title: '3. Deploy it as a web app',
    body: `<p>Click the blue <b>Deploy</b> button, top right, then <b>New deployment</b>. Click the gear ⚙ next to
      "Select type" and choose <b>Web app</b>. Set:</p>
      <ul><li><b>Execute as:</b> Me</li><li><b>Who has access:</b> Anyone</li></ul>
      <p>Then click <b>Deploy</b>. "Anyone" lets your devices reach it without signing in; the script can only open
      this one Sheet.</p>`,
  },
  {
    art: mock('Google', `<div class="tu-form"><span>Google hasn't verified this app</span>
      <span class="tu-sub">Advanced ›</span><span class="tu-sub">Go to HanziHome (unsafe)</span><em>Allow</em></div>`),
    title: '4. Allow it',
    body: `<p>Google asks you to <b>Authorize access</b>. Choose your account. Because the script is yours and not
      published, Google warns that it "hasn't verified this app": click <b>Advanced</b>, then <b>Go to … (unsafe)</b>,
      then <b>Allow</b>.</p>
      <p>That lets the script read and write the Sheet it is attached to, and nothing else.</p>`,
  },
  {
    art: mock('New deployment', `<div class="tu-form"><span>Web app</span>
      <span class="tu-url">https://script.google.com/macros/s/AKfy…/exec</span><em>Copy</em></div>`),
    title: '5. Copy the link and connect',
    body: `<p>Google shows the <b>Web app URL</b>, ending in <code>/exec</code>. Copy it, paste it into
      <b>Settings → Sync with Google Sheets</b>, and click <b>Connect</b>.</p>
      <p>On each of your other devices, paste the same link there. Keep the link private: anyone who has it can change
      your progress. Once connected, you can lock it with a passphrase.</p>`,
    last: 'sync',
  },
];

const TOUR_API = [
  {
    art: `<div class="tu-tiles"><b class="word">你好</b><em>→</em><b class="sound tu-en">Hello</b></div>`,
    title: 'Translate with Gemini',
    body: `<p>With a free key from <b>Google AI Studio</b>, the translator uses Google's Gemini: it translates whole
      sentences either way, turns pinyin into characters and explains the grammar.</p>
      <p>Without one it still works offline, word by word. Getting a key takes about 2 minutes and needs a Google
      account.</p>`,
  },
  {
    art: mock('aistudio.google.com', `<div class="tu-form"><span>Sign in with Google</span>
      <span class="tu-sub">Accept the terms (first time only)</span><em>Continue</em></div>`),
    title: '1. Open Google AI Studio',
    body: `<p>Open Google AI Studio's API keys page and sign in with your Google account. The first time, it asks you to
      accept its terms.</p>
      <p><a class="btn" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Open AI Studio</a></p>`,
  },
  {
    art: mock('API keys', `<div class="tu-form"><em>Create API key</em>
      <span class="tu-url">AQ.Ab8R••••••••••••••••</span><span class="tu-sub">Copy</span></div>`),
    title: '2. Create a key',
    body: `<p>Click <b>Create API key</b>. If it asks for a project, the one it suggests is fine. Then <b>copy</b> the
      key: a long code starting with <code>AQ.</code> or <code>AIza</code>.</p>
      <p>The free tier needs no card: it allows a number of translations a minute and a day.</p>`,
  },
  {
    art: mock('HanziHome · Settings', `<div class="tu-form"><span>Translator</span>
      <span class="tu-url">AQ.Ab8R••••••••</span><em>Save</em></div>`),
    title: '3. Paste it into HanziHome',
    body: `<p>Paste the key into <b>Settings → Translator</b> and click <b>Save</b>. It is kept in this browser only,
      so add it on each device you translate on.</p>
      <p><b>Keep it to yourself.</b> Don't post it or put it in public code: Google switches off keys it finds published.
      On the free tier Google may use what you translate to improve its products.</p>`,
    last: 'api',
  },
];

const TOURS = { intro: TOUR_INTRO, sync: TOUR_SYNC, api: TOUR_API };
// the last slide's button: what it says, and where it goes
const TOUR_END = {
  intro: ['Start studying', '#/study', null],
  sync: ['Open sync settings', '#/settings', 'sync-card'],
  api: ['Add my key', '#/settings', 'translate-card'],
};

async function copySyncScript(btn) {
  const note = document.getElementById('tour-copied');
  btn.disabled = true;
  try {
    const res = await fetch(SYNC_SCRIPT, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    await navigator.clipboard.writeText(await res.text());
    if (note) note.textContent = 'Copied. Now paste it into Code.gs.';
  } catch (e) {
    if (note) note.innerHTML = `Couldn't copy it here. <a href="${SYNC_SCRIPT_PAGE}" target="_blank" rel="noopener">Open it on GitHub</a>
      and copy it from there (the copy icon above the code).`;
  } finally { btn.disabled = false; }
}

/* go to a Settings card, after a guide */
function goToCard(hash, id) {
  const show = () => {
    const el = id && document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const input = el.querySelector('input');
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 400);
    Motion.play(el, 'm-pop');
  };
  if (location.hash === hash) show();
  else { location.hash = hash; setTimeout(show, 450); }
}

function tourSeen() {
  try { return !!localStorage.getItem(TOUR_KEY); } catch (e) { return true; }   // no storage: never pester
}
function tourDone() {
  try { localStorage.setItem(TOUR_KEY, String(Date.now())); } catch (e) { /* this visit only */ }
}

/* a guide, by name (intro, sync, api), from its first slide or another */
function showGuide(name, at = 0) { showTour(at, name); }

/* the dialog */
function showTour(at = 0, name = 'intro') {
  const TOUR = TOURS[name] || TOUR_INTRO;
  let dlg = document.getElementById('tour');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'tour';
    dlg.setAttribute('aria-labelledby', 'tour-title');
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => { if (dlg._name === 'intro') tourDone(); });
    dlg.addEventListener('click', e => {
      if (e.target === dlg) dlg.close();                       // the backdrop
      const act = e.target.closest('[data-tour-act]');
      if (act && act.dataset.tourAct === 'copy-script') copySyncScript(act);
      const b = e.target.closest('[data-tour]');
      if (!b) return;
      const go = b.dataset.tour;
      if (go === 'next') dlg._draw(dlg._at + 1);
      else if (go === 'back') dlg._draw(dlg._at - 1);
      else if (go === 'skip') dlg.close();
      else if (go === 'end') {
        const [, hash, card] = TOUR_END[dlg._name];
        dlg.close();
        goToCard(hash, card);
      }
      else dlg._draw(+go);
    });
    dlg.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select')) return;
      const n = TOURS[dlg._name].length;
      if (e.key === 'ArrowRight' && dlg._at < n - 1) { e.preventDefault(); dlg._draw(dlg._at + 1); }
      if (e.key === 'ArrowLeft' && dlg._at > 0) { e.preventDefault(); dlg._draw(dlg._at - 1); }
    });
    // a swipe, on a phone
    let x0 = null;
    dlg.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    dlg.addEventListener('touchend', e => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (dx < -50 && dlg._at < TOURS[dlg._name].length - 1) dlg._draw(dlg._at + 1);
      if (dx > 50 && dlg._at > 0) dlg._draw(dlg._at - 1);
    });
  }
  if (dlg._name !== name) dlg._at = undefined;           // (another guide: no slide to turn from)
  dlg._name = name;
  dlg._draw = draw;
  function draw(i) {
    const s = TOUR[i], from = dlg._at;
    dlg._at = i;
    dlg.innerHTML = `<div class="tour-card">
      <button class="tour-x" data-tour="skip" aria-label="Close the guide">×</button>
      <div class="tour-art" aria-hidden="true">${s.art}</div>
      <div class="tour-body">
        <p class="tour-n">${i + 1} of ${TOUR.length}</p>
        <h2 id="tour-title">${s.title}</h2>
        ${s.body}
      </div>
      <div class="tour-dots">${TOUR.map((_, j) => `<button data-tour="${j}" class="${j === i ? 'on' : ''}"
        aria-label="Slide ${j + 1}"${j === i ? ' aria-current="step"' : ''}></button>`).join('')}</div>
      <div class="tour-nav">
        ${i ? '<button class="btn quiet" data-tour="back">Back</button>' : '<button class="btn quiet" data-tour="skip">Skip</button>'}
        ${s.last ? `<button class="btn" data-tour="end">${TOUR_END[name][0]}</button>`
          : `<button class="btn" data-tour="next">${i ? 'Next' : 'Show me'}</button>`}
      </div></div>`;
    // the first slide rises in with the card; the others slide in from the side they are on
    if (dlg.open && from !== undefined && from !== i) {
      dlg.querySelector('.tour-card').classList.add('turning');
      for (const el of dlg.querySelectorAll('.tour-art > *, .tour-body')) Motion.play(el, i > from ? 'm-next' : 'm-prev');
    }
    if (dlg.open) focusNext();
  }
  function focusNext() {
    const b = dlg.querySelector('[data-tour="next"], [data-tour="end"]');
    if (b) b.focus();
  }
  draw(Math.max(0, Math.min(TOUR.length - 1, at)));
  if (!dlg.open) dlg.showModal();
  focusNext();
}

/* "show me how" anywhere: a button or link with data-guide="sync" or "api" */
document.addEventListener('click', e => {
  const g = e.target.closest('[data-guide]');
  if (!g || !TOURS[g.dataset.guide]) return;
  e.preventDefault();
  showGuide(g.dataset.guide);
});

/* on load: a newcomer's first visit gets the tour; anyone with progress is marked
   as having seen it */
(function firstVisit() {
  if (tourSeen()) return;
  const d = Store.load();
  if (Object.keys(d.items || {}).length || Object.keys(d.status || {}).length) { tourDone(); return; }
  setTimeout(() => { if (!tourSeen()) showTour(0); }, 400);
})();
