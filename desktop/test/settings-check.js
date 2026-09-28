/* Run inside the app's Settings page: drive the Desktop app card like a user,
 * check each change reaches the app, and put everything back as it was.
 *
 *   npx electron . --open=/settings --exec=test/settings-check.js --snapshot=test/out/settings.png
 *   (from desktop/; in Git Bash prefix MSYS_NO_PATHCONV=1 so /settings stays as it is)
 */
(async () => {
  const D = window.hanzihomeDesktop, wait = ms => new Promise(r => setTimeout(r, ms));
  const card = () => document.getElementById('desktop-card');
  for (let t = 0; t < 40 && !document.getElementById('dk-add'); t++) await wait(100);
  const before = (await D.settings()).settings;
  const out = {};

  // add a program by typing its name, as .exe too (it should be stored bare)
  document.getElementById('dk-add').value = 'SomeGame.exe';
  document.getElementById('dk-addbtn').click();
  await wait(400);
  out.added = (await D.settings()).settings.pause;
  out.chipShown = [...card().querySelectorAll('.dk-chip')].map(c => c.textContent.replace('×', '').trim());

  // turn off the red bars from the card
  document.getElementById('dk-new').click();
  await wait(400);
  out.newAfterClick = (await D.settings()).settings.show.new;

  // remove the program with its × button
  card().querySelector('[data-unpause="somegame"]').click();
  await wait(400);
  out.removed = (await D.settings()).settings.pause;

  // put back what was there
  await D.set({ pause: before.pause, show: before.show, overlay: before.overlay, hoverKey: before.hoverKey });
  const after = (await D.settings()).settings;
  out.restored = JSON.stringify(after) === JSON.stringify(before);
  return out;
})();
