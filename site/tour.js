/* tour.js — the tutorial: a few slides, in a dialog, on how learning Mandarin
 * works and how HanziHome teaches it.
 *
 * It opens by itself once, on a newcomer's first visit (nothing in their lessons,
 * nothing marked); someone who already has progress here never gets it unasked.
 * Settings has "Show the tutorial again". Whether it has been seen is kept on
 * this device only (localStorage). Needs Store and esc from app.js. */

'use strict';

const TOUR_KEY = 'hanzihome.tour';

const TOUR = [
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
      grammar. The <b>Words</b> and character pages are a dictionary with stroke order.</p>`,
  },
  {
    art: '<div class="tu-tiles"><b class="word">加油</b></div>',
    title: 'Ready?',
    body: `<p>Start with your first lessons: a handful of sounds, components and characters. Come back tomorrow for
      their first reviews. 加油 <i>jiāyóu</i>: you can do it!</p>`,
    last: true,
  },
];

function tourSeen() {
  try { return !!localStorage.getItem(TOUR_KEY); } catch (e) { return true; }   // no storage: never pester
}
function tourDone() {
  try { localStorage.setItem(TOUR_KEY, String(Date.now())); } catch (e) { /* this visit only */ }
}

/* the dialog, from the first slide (or another) */
function showTour(at = 0) {
  let dlg = document.getElementById('tour');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'tour';
    dlg.setAttribute('aria-labelledby', 'tour-title');
    document.body.appendChild(dlg);
    dlg.addEventListener('close', tourDone);
    dlg.addEventListener('click', e => {
      if (e.target === dlg) dlg.close();                       // the backdrop
      const b = e.target.closest('[data-tour]');
      if (!b) return;
      const go = b.dataset.tour;
      if (go === 'next') draw(dlg._at + 1);
      else if (go === 'back') draw(dlg._at - 1);
      else if (go === 'skip') dlg.close();
      else if (go === 'study') { dlg.close(); location.hash = '#/study'; }
      else draw(+go);
    });
    dlg.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' && dlg._at < TOUR.length - 1) { e.preventDefault(); draw(dlg._at + 1); }
      if (e.key === 'ArrowLeft' && dlg._at > 0) { e.preventDefault(); draw(dlg._at - 1); }
    });
    // a swipe, on a phone
    let x0 = null;
    dlg.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    dlg.addEventListener('touchend', e => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (dx < -50 && dlg._at < TOUR.length - 1) draw(dlg._at + 1);
      if (dx > 50 && dlg._at > 0) draw(dlg._at - 1);
    });
  }
  function draw(i) {
    const s = TOUR[i], from = dlg._at;
    dlg._at = i;
    dlg.innerHTML = `<div class="tour-card">
      <button class="tour-x" data-tour="skip" aria-label="Close the tutorial">×</button>
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
        ${s.last ? '<button class="btn" data-tour="study">Start studying</button>'
          : `<button class="btn" data-tour="next">${i ? 'Next' : 'Show me'}</button>`}
      </div></div>`;
    // the first slide rises in with the card; the others slide in from the side they are on
    if (dlg.open && from !== i) {
      dlg.querySelector('.tour-card').classList.add('turning');
      for (const el of dlg.querySelectorAll('.tour-art > *, .tour-body')) Motion.play(el, i > from ? 'm-next' : 'm-prev');
    }
    if (dlg.open) focusNext();
  }
  function focusNext() {
    const b = dlg.querySelector('[data-tour="next"], [data-tour="study"]');
    if (b) b.focus();
  }
  draw(Math.max(0, Math.min(TOUR.length - 1, at)));
  if (!dlg.open) dlg.showModal();
  focusNext();
}

/* on load: a newcomer's first visit gets the tour; anyone with progress is marked
   as having seen it */
(function firstVisit() {
  if (tourSeen()) return;
  const d = Store.load();
  if (Object.keys(d.items || {}).length || Object.keys(d.status || {}).length) { tourDone(); return; }
  setTimeout(() => { if (!tourSeen()) showTour(0); }, 400);
})();
