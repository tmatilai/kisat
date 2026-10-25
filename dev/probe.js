// Checks the Watch flow end to end on the demo competition, on the Worker
// (dev/AGENTS.md, "Running a probe"). It creates a Watch through the chip's
// menu, which keeps the menu and dialog split (docs/style.md, "A menu is not a
// dialog"), and follows it through a start and back. It covers the share, edit
// and pairing links, the athlete quick-filter and its two ways out, a meet
// never opened, a list with nobody entered here and a relay followed by its
// club. Its later blocks add a name from the athlete sheet, write one list from
// two devices, and delete and copy a list.
//   dev/probe.html?url=c/demo
export default async function probe({ frame, W, D, log, ok, wait, appJs, settle }) {
  const appText = () => D.getElementById('app').textContent;
  // Reads the day's own list, since the class and discipline filter above it
  // names every discipline.
  const dayText = () => [...D.querySelectorAll('#app > .list')].pop()?.textContent || '';
  // The headless clipboard refuses a write, and copyText (app/shell.js) then
  // falls back to window.prompt, which Playwright dismisses unread. The stub
  // takes the text a click copies.
  const copiedBy = async (click) => {
    let text = null;
    W.navigator.clipboard.writeText = async (t) => {
      text = t;
    };
    click();
    await wait(300);
    delete W.navigator.clipboard.writeText;
    return text;
  };

  // The run starts clean. A navigation away and back re-renders with the
  // clean state, since reload() would replace contentDocument and leave D
  // pointing at the detached one.
  for (const k of Object.keys(W.localStorage)) {
    if (k.startsWith('kisatWatchEdit:') || k === 'kisatWatches' || k === 'kisatCompView' || k === 'kisatFollow') {
      W.localStorage.removeItem(k);
    }
  }
  appJs.navigate('/');
  await settle();
  appJs.navigate('/c/demo');
  await settle();

  ok('landed on #/c/demo', W.location.pathname === '/c/demo');
  const selectBtn = [...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('Ei seurantaa'));
  ok('filter bar shows "Ei seurantaa" with no watch active', !!selectBtn);
  ok('no mode toggle without an active filter', !D.querySelector('.filter-bar .seg'));
  ok('plain day list shows every start', dayText().includes('Kuula') && dayText().includes('Keihäs'));

  // --- Create a Watch through the chip's menu ---
  selectBtn.click();
  await settle();
  ok('the chip opened a menu', !!D.querySelector('.sheet .menu'));
  // A menu is a list of choices, and a dialog is a form (docs/style.md). The
  // menu's card holds no full-width .btn. Its items are .rows, each with the
  // tick column that lines the labels up. (Break on purpose: build the menu
  // out of .btns.)
  ok(
    'the menu holds choices, not a stack of buttons',
    !D.querySelector('.sheet-card .btn') &&
      D.querySelectorAll('.sheet .menu .row').length >= 2 &&
      D.querySelectorAll('.sheet .menu .menu-check').length === D.querySelectorAll('.sheet .menu .row').length,
  );
  ok(
    '"Ei seurantaa" is the ticked choice with nothing followed',
    [...D.querySelectorAll('.sheet .menu .row')]
      .find((r) => r.textContent.includes('Ei seurantaa'))
      ?.querySelector('.menu-check')?.textContent === '✓',
  );
  // The × in the card's top-right corner is the way out, and the card has no
  // "Sulje" button. Its row is sticky, so it stays in reach while the card
  // scrolls (.sheet-head, index.html).
  {
    const card = D.querySelector('.sheet-card');
    const x = D.querySelector('.sheet-close');
    const cr = card.getBoundingClientRect();
    const xr = x?.getBoundingClientRect();
    ok(
      'sheet has an × and no "Sulje" button',
      !!x && ![...D.querySelectorAll('.sheet button')].some((b) => b.textContent === 'Sulje'),
    );
    log(`× at top=${(xr?.top - cr.top).toFixed(0)}px right=${(cr.right - xr?.right).toFixed(0)}px from card`);
    ok(
      "× sits in the card's top-right corner",
      xr.top - cr.top < 24 && cr.right - xr.right < 24 && xr.right > cr.left + cr.width / 2,
    );
    ok('× stays put while the card scrolls', W.getComputedStyle(x.parentElement).position === 'sticky');
  }
  // Escape is the keyboard's way out. It is dispatched from a control in the
  // sheet, where focus is. It bubbles to the listener on document.
  const esc = () =>
    D.querySelector('.sheet-close').dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  // Escape closes only the top layer. On home a second sheet can stack, as
  // Tab and Enter reach the header's ? under the backdrop. This view has no ?,
  // so textSheet opens a stand-in on top. The layer stack and not the DOM
  // says which sheet is on top (docs/architecture.md, "Layers").
  appJs.textSheet('Päällimmäinen', ['Seuranta-arkin päälle avattu toinen kerros.']);
  await wait(200);
  ok('a second sheet stacks on the first', D.querySelectorAll('.sheet').length === 2);
  esc();
  await wait(200);
  ok(
    'Escape takes the top sheet and leaves the one under it',
    D.querySelectorAll('.sheet').length === 1 && !!D.querySelector('.sheet .menu'),
  );
  esc();
  await wait(200);
  ok('Escape closes the sheet', !D.querySelector('.sheet'));

  // --- A menu hangs off the button that opened it, at a phone's width too ---
  {
    selectBtn.click();
    await settle();
    const card = D.querySelector('.sheet-card');
    const btn = selectBtn.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    log(
      `chip at ${btn.left.toFixed(0)},${btn.bottom.toFixed(0)} — card at ${cr.left.toFixed(0)},${cr.top.toFixed(0)} (${cr.width.toFixed(0)}px wide)`,
    );
    // (Break on purpose: drop openMenu's anchoring, and the card drops to the
    // bottom of the viewport, a screenful below its ▾.)
    ok(
      'the menu hangs off the chip, not the bottom of the viewport',
      Math.abs(cr.left - btn.left) <= 1 && cr.top - btn.bottom > 0 && cr.top - btn.bottom < 16,
    );
    ok(
      'and stops dimming the page, since a menu is not modal',
      W.getComputedStyle(D.querySelector('.sheet')).backgroundColor.replace(/\s/g, '') === 'rgba(0,0,0,0)',
    );

    // A scroll inside the menu's own card moves no anchor, so the menu stays
    // open (anchorMoved, lib/routes.js). (Break on purpose: close on any scroll
    // event, and a menu closes as the reader scrolls to the row they seek.)
    card.dispatchEvent(new W.Event('scroll'));
    await wait(150);
    ok('a scroll that leaves the chip where it is keeps the menu', !!D.querySelector('.sheet'));
    // The page under an anchored menu is not locked, as a lock makes the
    // layer modal.
    W.scrollTo(0, 240);
    await wait(300);
    log(
      `after scrolling: scrollY=${W.scrollY} chip at ${selectBtn.getBoundingClientRect().top.toFixed(0)}, sheets=${D.querySelectorAll('.sheet').length}`,
    );
    // The page has to move, or every check here passes on a menu that never
    // had to do anything.
    ok('the page under an anchored menu does scroll', W.scrollY > 0);
    // (Break on purpose: drop openMenu's anchor watch, and the card stays put
    // while its chip slides away.)
    ok('and the menu goes with it rather than floating free of its chip', !D.querySelector('.sheet'));
    W.scrollTo(0, 0);
    await wait(200);
  }

  selectBtn.click();
  await settle();
  [...D.querySelectorAll('.sheet .menu .row')].find((r) => r.textContent.includes('Uusi seuranta')).click();
  await settle();
  ok('create dialog opened', !!D.querySelector('.sheet .watch-create input[type="search"]'));
  // A dialog's buttons span the card, the other half of the split above.
  // (Break on purpose: drop both .sheet-card .btn's width and .watch-create's
  // flex stretch, since either alone spans the card.)
  ok(
    'the dialog does have a full-width button',
    parseFloat(W.getComputedStyle(D.querySelector('.sheet-card .btn')).width) >
      D.querySelector('.sheet-card').clientWidth * 0.8,
  );
  // The results and the card each scroll, as a broad search matches dozens.
  {
    const results = D.querySelector('.watch-search-results');
    const card = D.querySelector('.sheet-card');
    const rs = results && W.getComputedStyle(results);
    const cs = card && W.getComputedStyle(card);
    ok(
      'search-results list capped and independently scrollable',
      rs?.overflowY === 'auto' && parseFloat(rs?.maxHeight) < W.innerHeight,
    );
    ok(
      'sheet card itself also capped and scrollable',
      cs?.overflowY === 'auto' && parseFloat(cs?.maxHeight) < W.innerHeight,
    );
  }

  const search = D.querySelector('.sheet input[type="search"]');
  search.value = 'Emma';
  search.dispatchEvent(new W.Event('input', { bubbles: true }));
  await settle(300); // the debounce, then GET /api/search
  // The row is found by her whole name. The fixture has another Emma who
  // sorts above her, and a Watch on that Emma fails every check below as
  // though the filter were broken.
  const emmaRow = [...D.querySelectorAll('.sheet .list .row')].find((r) =>
    r.querySelector('.row-title')?.textContent.includes('Emma Mittainen'),
  );
  ok('found Emma Mittainen in search results', !!emmaRow);

  // A runner in an individual event and a relay is one search row. The
  // relay's roster row mints an Id of its own and shares the licence, and
  // rosterPeople (lib/roster.js) keys on the licence and the club.
  {
    search.value = 'Mallinen';
    search.dispatchEvent(new W.Event('input', { bubbles: true }));
    await settle(300);
    const villeRows = [...D.querySelectorAll('.sheet .list .row')].filter((r) =>
      r.querySelector('.row-title')?.textContent.includes('Ville Mallinen'),
    );
    ok('a relay runner with an individual event is offered once, not twice', villeRows.length === 1);
    search.value = 'Emma';
    search.dispatchEvent(new W.Event('input', { bubbles: true }));
    await settle(300);
  }
  emmaRow.click();
  await wait(200);
  const labelInput = D.querySelector('.sheet .watch-create input[type="text"]');
  labelInput.value = 'Testiseuranta';
  labelInput.dispatchEvent(new W.Event('input', { bubbles: true }));
  D.querySelector('.sheet button.btn:not(.btn-secondary)').click(); // "Luo seuranta"
  await settle();

  // --- Creating a Watch lands in the filtered view on the same path ---
  ok('still on #/c/demo after create (no #/w/ round-trip)', W.location.pathname === '/c/demo');
  const registry = JSON.parse(W.localStorage.getItem('kisatWatches') || '[]');
  const watchId = registry[0]?.watchId;
  log(`watch id: ${watchId}`);
  ok('watch registered locally', /^[0-9a-f]{12}$/.test(watchId || ''));
  ok('editToken remembered', !!W.localStorage.getItem(`kisatWatchEdit:${watchId}`));
  // The stored row's watchId is never read. viewStateFor takes the active
  // list from kisatFollow, which the next check reads.
  ok(
    'view state is in watched mode',
    JSON.parse(W.localStorage.getItem('kisatCompView') || '[]')[0]?.mode === 'watched',
  );
  // Creating also makes it the active list on every view (activeFollow).
  ok(
    'the new watch became the device-wide default',
    JSON.parse(W.localStorage.getItem('kisatFollow') || 'null') === watchId,
  );
  ok(
    'day list filtered down to Keihäs with Emma inline',
    dayText().includes('Keihäs') && dayText().includes('Emma Mittainen') && !dayText().includes('Kuula'),
  );
  const modeSeg = D.querySelector('.filter-bar .seg');
  ok(
    'mode toggle present with "Seuratut" pressed',
    modeSeg?.querySelector('[aria-pressed="true"]')?.textContent === 'Seuratut',
  );

  // --- Filter bar fits a phone width ---
  {
    const bar = D.querySelector('.filter-bar');
    log(
      `filter bar at ${frame.width}px: width=${bar?.getBoundingClientRect().width.toFixed(0)}px scrollWidth=${bar?.scrollWidth}`,
    );
    ok('filter bar does not overflow phone width', (bar?.scrollWidth || 0) <= W.innerWidth);
  }

  // --- "Koko päivä" shows every start and marks the followed one ---
  [...modeSeg.querySelectorAll('.seg-btn')].find((b) => b.textContent === 'Koko päivä').click();
  await settle();
  ok('full-day mode shows every start again', dayText().includes('Kuula'));
  const watchedRow = D.querySelector('.list a.row.watched');
  ok('the followed group row is highlighted', !!watchedRow?.textContent.includes('Keihäs'));
  ok('and still carries the athlete line', !!watchedRow?.querySelector('.watch-row-athlete'));
  ok('mode remembered in view state', JSON.parse(W.localStorage.getItem('kisatCompView') || '[]')[0]?.mode === 'all');

  // --- A round trip through the event view keeps the state and scroll ---
  frame.height = 260; // force the day list to overflow so there is scroll to restore
  await wait(100);
  W.scrollTo(0, 120);
  await wait(100);
  const scrollBefore = W.scrollY;
  const keihasRow = [...D.querySelectorAll('.list a.row')].find((r) => r.textContent.includes('Keihäs'));
  keihasRow.click();
  await settle();
  ok('event view opened', /^\/c\/demo\/g\//.test(W.location.pathname));
  ok('followed athlete highlighted in the table', !!D.querySelector('tr.watched'));
  const backBtn = D.getElementById('back');
  ok('`<` targets the schedule day, no watch id in it', /^\/c\/demo\/d\//.test(backBtn?.getAttribute('href') || ''));
  backBtn.click();
  await settle();
  ok(
    'back on the schedule view in full-day mode (state, not URL, remembered it)',
    dayText().includes('Kuula') && !!D.querySelector('.list a.row.watched'),
  );
  log(`scroll: before=${scrollBefore} after=${W.scrollY}`);
  ok('scroll position restored on the way back', scrollBefore > 0 && Math.abs(W.scrollY - scrollBefore) <= 2);
  frame.height = 787;
  await wait(100);

  // --- One menu picks a list and acts on it ---
  // The actions sit under the row they act on, and the bar has no second menu.
  const chipBtn = () =>
    [...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('Testiseuranta'));
  ok(
    'no ⋯ on the filter bar any more',
    ![...D.querySelectorAll('.filter-bar button')].some((b) => b.textContent === '⋯'),
  );
  chipBtn().click();
  await settle();
  {
    const rows = [...D.querySelectorAll('.sheet .menu .row')];
    const picked = rows.find((r) => r.querySelector('.menu-check')?.textContent === '✓');
    log(`menu rows: ${rows.map((r) => r.querySelector('.row-title').textContent).join(' | ')}`);
    ok('the created list is the ticked row', !!picked?.textContent.includes('Testiseuranta'));
    const actions = [...picked.querySelectorAll('.menu-action')].map((b) => b.textContent);
    log(`actions under it: ${actions.join(' · ')}`);
    // (Break on purpose: hang the actions off the menu and not off the row,
    // and the ticked row carries none.)
    ok(
      'its own actions are inline underneath it',
      actions.includes('Muokkaa') &&
        actions.some((t) => t.startsWith('Jaa')) &&
        actions.some((t) => t.startsWith('Unohda')),
    );
    ok('the actions fit the phone width without scrolling sideways', picked.scrollWidth <= picked.clientWidth + 1);
  }
  // A second list gives the menu a choice to make. It goes straight into the
  // registry, the device's list of {watchId, label} (watchRegistryAdd,
  // lib/watch.js), where a share link puts one too. Its id is no real Watch,
  // and the tap is checked by what kisatFollow becomes.
  D.querySelector('.sheet-close').click();
  await wait(200);
  {
    const reg = JSON.parse(W.localStorage.getItem('kisatWatches') || '[]');
    W.localStorage.setItem(
      'kisatWatches',
      JSON.stringify([...reg, { watchId: '0123456789ab', label: 'Perheen kisat' }]),
    );
    chipBtn().click();
    await settle();
    const rows = [...D.querySelectorAll('.sheet .menu .row')];
    log(`menu rows with two lists known: ${rows.map((r) => r.querySelector('.row-title').textContent).join(' | ')}`);
    // The lists lead the menu and the rows about the set of them close it. A
    // foot row among the lists would read as one to follow, so the check
    // names every row.
    const labels = rows.map((r) => r.querySelector('.row-title').textContent);
    ok(
      'every list this device knows is offered, above the rows that are not lists',
      labels.slice(0, 2).join(' | ') === 'Testiseuranta | Perheen kisat' &&
        labels.slice(2).join(' | ') ===
          'Ei seurantaa | Uusi seuranta | Siirrä toiseen laitteeseen | Ota linkki käyttöön',
    );
    // (Break on purpose: hang the actions off every row, and "Jaa" under a
    // list not on screen shares the wrong one.)
    ok(
      'only the selected row carries its actions',
      rows.filter((r) => r.querySelector('.menu-action')).length === 1 &&
        rows.filter((r) => r.querySelector('.menu-check').textContent === '✓').length === 1,
    );
    // A tap on a row makes that list the active one on every view.
    rows.find((r) => r.textContent.includes('Perheen kisat')).click();
    await settle();
    ok(
      'a row tap switches the active list and closes the menu',
      !D.querySelector('.sheet') && JSON.parse(W.localStorage.getItem('kisatFollow') || 'null') === '0123456789ab',
    );
    // The real list goes back and the stand-in goes, as every later check is
    // about the list that exists.
    W.localStorage.setItem('kisatWatches', JSON.stringify(reg));
    W.localStorage.setItem('kisatFollow', JSON.stringify(watchId));
    appJs.navigate('/');
    await settle();
    appJs.navigate('/c/demo');
    await settle();
  }
  // The × is the card's only way out, so it has to close.
  chipBtn().click();
  await settle();
  D.querySelector('.sheet-close').click();
  await wait(200);
  ok('× closes the sheet', !D.querySelector('.sheet'));
  chipBtn().click();
  await settle();
  [...D.querySelectorAll('.sheet .menu-action')].find((b) => b.textContent.startsWith('Unohda')).click();
  await settle();
  ok(
    'after Unohda the bar is back to "Ei seurantaa"',
    [...D.querySelectorAll('.filter-bar button')].some((b) => b.textContent.includes('Ei seurantaa')),
  );
  ok('registry row gone', !JSON.parse(W.localStorage.getItem('kisatWatches') || '[]').length);
  ok('editToken deliberately survives Unohda', !!W.localStorage.getItem(`kisatWatchEdit:${watchId}`));
  // Forgetting also clears the active list. Otherwise the next meet would
  // resolve it and register it again (resolveFilter, app/follow.js).
  ok('the device-wide default was dropped too', !JSON.parse(W.localStorage.getItem('kisatFollow') || 'null'));

  // --- A bare #/w/<id> link lands on home, as a Watch belongs to no meet ---
  appJs.navigate(`/#/w/${watchId}`);
  await settle();
  ok('bare share link lands on home', W.location.pathname === '/');
  ok('and activated the watch device-wide', JSON.parse(W.localStorage.getItem('kisatFollow') || 'null') === watchId);
  ok(
    'home says which list was taken into use',
    (D.getElementById('updated')?.textContent || '').includes('otettu käyttöön'),
  );

  // --- The link "Jaa linkki" copies names the meet and lands on it ---
  appJs.navigate(`/c/demo#/w/${watchId}`);
  await settle();
  ok('share link redirected to the schedule view', W.location.pathname === '/c/demo');
  ok('watch active again, filtered list back', dayText().includes('Emma Mittainen') && !dayText().includes('Kuula'));
  ok('re-registered locally', JSON.parse(W.localStorage.getItem('kisatWatches') || '[]')[0]?.watchId === watchId);

  // --- The read link against the edit link ---
  // Without the token this device is any other recipient, so the menu offers
  // nothing that writes. The edit link makes it offer both links.
  const editToken = W.localStorage.getItem(`kisatWatchEdit:${watchId}`);
  const menuActions = () => {
    const picked = [...D.querySelectorAll('.sheet .menu .row')].find(
      (r) => r.querySelector('.menu-check')?.textContent === '✓',
    );
    return { picked, labels: [...picked.querySelectorAll('.menu-action')].map((b) => b.textContent) };
  };
  // Opens the menu and clicks a share action, which closes it. Gives the
  // copied link's path and hash.
  const copiedLink = async (label) => {
    chipBtn().click();
    await settle();
    const action = [...D.querySelectorAll('.sheet .menu-action')].find((b) => b.textContent === label);
    const url = new URL(await copiedBy(() => action.click()));
    return `${url.pathname}${url.hash}`;
  };
  W.localStorage.removeItem(`kisatWatchEdit:${watchId}`);
  appJs.navigate('/');
  await settle();
  appJs.navigate('/c/demo');
  await settle();
  chipBtn().click();
  await settle();
  {
    const { labels } = menuActions();
    log(`actions without the token: ${labels.join(' · ')}`);
    // (Break on purpose: offer the edit link without the token, and a
    // recipient gets a link that silently activates the Watch read-only.)
    ok(
      'a recipient is offered only what a reader can do',
      labels.includes('Jaa linkki') && !labels.includes('Muokkaa') && !labels.some((t) => t.startsWith('Jaa muokkaus')),
    );
    // With no edit link beside it, the read link is just "Jaa linkki".
    // (Break on purpose: make the label unconditional, and this check or the
    // one with the token fails.)
    ok('and its one share action is not named against a link that is absent', !labels.includes('Jaa katselulinkki'));
    // The copy takes "Muokkaa"'s place as what a reader can do. The last
    // block of this file follows it through.
    ok("and the write action's place is taken by the one a reader can use", labels[0] === 'Kopioi omaksi seurannaksi');
  }
  D.querySelector('.sheet-close').click();
  await wait(200);
  {
    const read = await copiedLink('Jaa linkki');
    log(`a recipient copies: ${read}`);
    ok("a recipient's link is the read link, back to this meet", read === `/c/demo#/w/${watchId}`);
  }

  appJs.navigate(`/c/demo#/w/${watchId}/e/${editToken}`);
  await settle();
  ok('the edit link lands on the meet like any share link', W.location.pathname === '/c/demo');
  ok(
    'and stored the write capability on this device',
    W.localStorage.getItem(`kisatWatchEdit:${watchId}`) === editToken,
  );
  // The filter chip says which list is on and never that it became
  // editable, so the flash is the only sign the link did anything extra.
  ok(
    'the reader is told the link made them an editor',
    (D.getElementById('updated')?.textContent || '').toLowerCase().includes('voit muokata'),
  );
  {
    // The status line is one nowrap row beside the title, so the message
    // names the list only where nothing else does (activateWatchLink).
    const h = D.querySelector('header');
    const h1 = D.querySelector('header h1');
    log(`header: "${D.getElementById('updated').textContent}" leaves h1 ${h1.clientWidth}px of ${h.clientWidth}`);
    ok('and the header still fits the phone width with it', h.scrollWidth <= h.clientWidth + 1 && h1.clientWidth > 80);
  }
  chipBtn().click();
  await settle();
  {
    const { picked, labels } = menuActions();
    log(`actions with it: ${labels.join(' · ')}`);
    ok(
      'the same menu now offers the writes too',
      labels.includes('Muokkaa') &&
        labels.includes('Jaa katselulinkki') &&
        labels.includes('Jaa muokkauslinkki') &&
        labels.some((t) => t.startsWith('Unohda')),
    );
    // The two links are told apart by their names, as a menu carries no prose
    // (docs/style.md). The front page's help sheet says an edit link cannot
    // be taken back.
    ok(
      'and the menu carries no sentence of its own',
      !picked.querySelector('.menu-hint') && !picked.querySelector('p'),
    );
    // The four actions stand one per line with nothing between them. (Break
    // on purpose: set .menu-actions to flex-direction: row, and the first two
    // checks below fail.)
    {
      const btns = [...picked.querySelectorAll('.menu-action')];
      const box = picked.querySelector('.menu-actions').getBoundingClientRect();
      const geom = btns.map((b) => b.getBoundingClientRect());
      log(
        `action lines: ${geom.map((r) => `${(r.left - box.left).toFixed(0)}+${r.width.toFixed(0)}@${(r.top - box.top).toFixed(0)}`).join(' ')}`,
      );
      ok(
        'each action is on a line of its own',
        new Set(geom.map((r) => Math.round(r.top))).size === btns.length &&
          new Set(geom.map((r) => Math.round(r.left))).size === 1,
      );
      // The width makes the target. The height bound catches only a collapse
      // to bare text, which is about 17 px tall.
      ok(
        'and is a full-width target, not a run of text',
        geom.every((r) => r.width >= box.width - 1 && r.height >= 24),
      );
      ok('with nothing separating them', !picked.querySelector('.menu-sep'));
    }
    ok('the action row still fits the phone width', picked.scrollWidth <= picked.clientWidth + 1);
  }
  D.querySelector('.sheet-close').click();
  await wait(200);
  {
    const read = await copiedLink('Jaa katselulinkki');
    const edit = await copiedLink('Jaa muokkauslinkki');
    log(`an editor copies: ${read} and ${edit.replace(editToken, '<token>')}`);
    // (Break on purpose: have copyWatchLink pass watchEditToken(watchId) to
    // watchLink, and the read link hands out write access.)
    ok("an editor's read link carries no token", read === `/c/demo#/w/${watchId}`);
    ok('and the edit link carries it', edit === `/c/demo#/w/${watchId}/e/${editToken}`);
  }

  // --- A stored token is only a claim until a write checks it ---
  // An edit link cut short leaves a "Muokkaa" that cannot save. The save
  // fails loudly, and the menu stops offering it.
  W.localStorage.setItem(`kisatWatchEdit:${watchId}`, '0'.repeat(32));
  chipBtn().click();
  await settle();
  [...D.querySelectorAll('.sheet .menu-action')].find((b) => b.textContent === 'Muokkaa').click();
  await settle();
  ok('a wrong token still opens the editor, since only a write can tell', !!D.querySelector('.watch-create'));
  [...D.querySelectorAll('.sheet .btn')].find((b) => b.textContent === 'Tallenna').click();
  await settle();
  log(`save says: ${D.querySelector('.watch-create > .notice')?.textContent}`);
  ok(
    "the save fails in the sheet, in the Worker's own words",
    (D.querySelector('.watch-create > .notice')?.textContent || '').includes('muokkausavain'),
  );
  // (Break on purpose: keep the token on a 403, and "Muokkaa" stays on offer
  // to a device that can never save.)
  ok('and the token that cannot write is dropped', !W.localStorage.getItem(`kisatWatchEdit:${watchId}`));
  D.querySelector('.sheet-close').click();
  await wait(200);
  // The real token goes back, as every later block edits this Watch through
  // the API.
  W.localStorage.setItem(`kisatWatchEdit:${watchId}`, editToken);
  appJs.navigate('/');
  await settle();
  appJs.navigate('/c/demo');
  await settle();

  // --- The athlete quick-filter's activation link, on Emma's roster id ---
  // The Watch is left on "Koko päivä" first. The athlete link forces
  // Seuratut and leaves the Watch's own stored mode alone.
  [...D.querySelectorAll('.filter-bar .seg-btn')].find((b) => b.textContent === 'Koko päivä').click();
  await settle();
  ok(
    'watch put back into full-day mode before the athlete test',
    JSON.parse(W.localStorage.getItem('kisatCompView') || '[]')[0]?.mode === 'all',
  );
  appJs.navigate('/c/demo#/a/g1-a');
  await settle();
  ok('athlete link redirected to the schedule view', W.location.pathname === '/c/demo');
  const pressed = () =>
    [...D.querySelectorAll('.filter-bar .seg-btn')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent;
  ok('the athlete filter forced Seuratut mode, despite the watch being on Koko päivä', pressed() === 'Seuratut');
  ok(
    "and the watch's own mode is untouched underneath",
    JSON.parse(W.localStorage.getItem('kisatCompView') || '[]')[0]?.mode === 'all',
  );
  const athleteChip = D.querySelector('.filter-bar .watch-chip');
  ok(
    'athlete chip shows the name with an ×',
    !!athleteChip?.textContent.includes('Emma Mittainen') && !!athleteChip?.querySelector('.watch-chip-remove'),
  );
  // The chip reads "Näytä: <name>", a state to come back from, not a title.
  ok(
    'athlete chip frames the name as a state',
    athleteChip?.querySelector('.watch-chip-prefix')?.textContent === 'Näytä:',
  );
  ok('day list filtered to her events', dayText().includes('Keihäs') && !dayText().includes('Kuula'));
  {
    // Padding grows the × to a touch target, and a negative margin keeps the
    // chip's size (.filter-bar .watch-chip-remove, index.html).
    const chipBox = athleteChip.getBoundingClientRect();
    const xBox = athleteChip.querySelector('.watch-chip-remove').getBoundingClientRect();
    log(
      `chip ${chipBox.width.toFixed(0)}×${chipBox.height.toFixed(0)}, × target ${xBox.width.toFixed(1)}×${xBox.height.toFixed(1)}`,
    );
    ok('the × is a real touch target', xBox.width >= 32 && xBox.height >= 32);
    ok('and the chip is still control-sized around it', chipBox.height <= 40);
  }
  athleteChip.querySelector('.watch-chip-remove').click();
  await settle();
  ok(
    'clearing the athlete filter falls back to the watch, still on Koko päivä as left',
    pressed() === 'Koko päivä' &&
      dayText().includes('Kuula') &&
      !!D.querySelector('.list a.row.watched') &&
      ![...D.querySelectorAll('.filter-bar button')].some((b) => b.textContent.includes('Ei seurantaa')),
  );

  // --- A tapped name opens the athlete sheet and its quick-filter ---
  // The day list's name is a role=link span inside the row's <a>, and its
  // tap must not open the row. The results table's name is a real <a>. This
  // runs on "Koko päivä", so the day list left behind is the long one that
  // the scroll and `<` checks need.
  const lineLink = D.querySelector('.watch-row-athlete .athlete-link');
  ok('day-list athlete name carries the link affordance', !!lineLink);
  // The quick-filter is a shorter list at the same URL. It must not inherit
  // the day list's offset, and popping it must find that offset again. At
  // 140 px the filtered list can still reach the offset, so the check below
  // is not vacuous.
  frame.height = 140;
  await wait(100);
  W.scrollTo(0, 90);
  await wait(100);
  const dayScroll = W.scrollY;
  const showAll = () =>
    [...D.querySelectorAll('.sheet .btn')].find((b) => b.textContent.includes('Näytä kaikki lajit'));
  lineLink.click();
  await settle();
  ok(
    "clicking it opens the athlete sheet, not the row's event",
    W.location.pathname === '/c/demo' && !!D.querySelector('.sheet .athlete-sheet'),
  );
  showAll().click();
  await settle();
  ok(
    'and the sheet\'s "Näytä kaikki lajit" filters the day list',
    W.location.pathname === '/c/demo' && !D.querySelector('.sheet') && !!D.querySelector('.filter-bar .watch-chip'),
  );
  {
    // room > dayScroll keeps the next check from passing vacuously. A list
    // too short to reach the offset reads as "at the top" whatever the key.
    const room = D.scrollingElement.scrollHeight - W.innerHeight;
    log(`scroll: day list at ${dayScroll}, filtered list at ${W.scrollY}, room ${room}`);
    ok(
      "the filtered list opens at the top, not at the day list's offset",
      dayScroll > 0 && room > dayScroll && W.scrollY === 0,
    );
  }
  // The header's `<` pops the filter layer and stays on the meet (setBack,
  // app/shell.js).
  const filterBack = D.getElementById('back');
  ok('`<` points at this competition while the filter is on, not home', filterBack.getAttribute('href') === '/c/demo');
  filterBack.click();
  await settle();
  ok(
    '`<` cleared the filter and stayed on the schedule view',
    W.location.pathname === '/c/demo' && !D.querySelector('.filter-bar .watch-chip') && dayText().includes('Kuula'),
  );
  ok('and the day list came back where it was left', Math.abs(W.scrollY - dayScroll) <= 2);
  ok('`<` is a plain link home again with nothing left to pop', D.getElementById('back').getAttribute('href') === '/');
  frame.height = 787;
  await wait(100);
  [...D.querySelectorAll('.list a.row')].find((r) => r.textContent.includes('Keihäs')).click();
  await settle();
  const tblLink = D.querySelector('.cell-name a.athlete-link');
  ok('results-table athlete name is a real link', !!tblLink);
  tblLink.click();
  await settle();
  ok('which opens the same sheet over the start', !!D.querySelector('.sheet .athlete-sheet'));
  showAll().click();
  await settle();
  ok(
    'and its filter lands on the filtered schedule view',
    W.location.pathname === '/c/demo' && !!D.querySelector('.filter-bar .watch-chip'),
  );

  // --- A meet this device has never opened inherits the active list ---
  // Dropping kisatCompView and keeping the registry and kisatFollow is the
  // state a new meet starts from.
  {
    W.localStorage.removeItem('kisatCompView');
    appJs.navigate('/');
    await settle();
    appJs.navigate('/c/demo');
    await settle();
    ok(
      'an unopened competition starts with the active list applied',
      !![...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('Testiseuranta')) &&
        dayText().includes('Emma Mittainen') &&
        !dayText().includes('Kuula'),
    );
  }

  // --- A list with none of its people entered here ---
  // The whole day shows unfiltered, with a notice naming why. The Watch is
  // rewritten through the API to follow a licence nobody here holds.
  {
    const editToken = W.localStorage.getItem(`kisatWatchEdit:${watchId}`);
    const r = await W.fetch(`/api/watch/${watchId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-kisat-client': '1' },
      body: JSON.stringify({
        editToken,
        label: 'Muualla kilpailevat',
        entries: [{ type: 'athlete', id: '99999999', name: 'Joku Muu', enabled: true }],
      }),
    });
    ok('rewrote the watch to someone not in this competition', r.ok);
    appJs.navigate('/');
    await settle();
    appJs.navigate('/c/demo');
    await settle();
    ok(
      'the whole day is shown, not an empty filtered list',
      dayText().includes('Kuula') && dayText().includes('Keihäs'),
    );
    ok('with a notice naming why the list had no effect', appText().includes('ei osallistu tähän kilpailuun'));
    ok('and no mode toggle, since there is nothing here to filter by', !D.querySelector('.filter-bar .seg'));
  }

  // --- A relay belongs to the club that entered the team ---
  // The demo's relay has a Demon Urheilijat team with a Mallikylän Vire
  // runner in it, and a Mallikylän Vire team of its own (allocMatches,
  // lib/watch.js). A club entry tells them apart on the day list and in the
  // tables.
  const clubWatch = async (orgId, name) => {
    const editToken = W.localStorage.getItem(`kisatWatchEdit:${watchId}`);
    await W.fetch(`/api/watch/${watchId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-kisat-client': '1' },
      body: JSON.stringify({
        editToken,
        label: name,
        entries: [{ type: 'club', id: String(orgId), name, enabled: true }],
      }),
    });
    appJs.navigate('/');
    await settle();
    appJs.navigate('/c/demo');
    await settle();
  };
  {
    await clubWatch(1, 'Demon Urheilijat');
    ok(
      'the entering club sees its own relay team in the day list',
      dayText().includes('4x100m viesti') && dayText().includes('Demon Urheilijat'),
    );
    ok("and its own athletes' individual events with it", dayText().includes('Keihäs'));

    await clubWatch(2, 'Mallikylän Vire');
    const relayRow = [...D.querySelectorAll('.list a.row')].find((r) => r.textContent.includes('4x100m'));
    ok('the other club sees the relay too — it has a team of its own', !!relayRow);
    ok(
      'but only its own team on the row, not the one its runner guests in',
      relayRow.textContent.includes('Mallikylän Vire') && !relayRow.textContent.includes('Demon Urheilijat'),
    );

    relayRow.click();
    await settle();
    const watchedRows = [...D.querySelectorAll('tr.watched')];
    ok(
      "event view highlights that club's own team row only",
      watchedRows.length === 1 && watchedRows[0].textContent.includes('Mallikylän Vire'),
    );
  }

  // --- Adding a name from the athlete sheet ---
  // The Watch is still the club list the block above left. The add brings in
  // someone it has no entry for, and the server is asked what it holds.
  {
    appJs.navigate('/c/demo');
    await settle();
    const koko = [...D.querySelectorAll('.filter-bar .seg-btn')].find((b) => b.textContent === 'Koko päivä');
    if (koko && koko.getAttribute('aria-pressed') !== 'true') {
      koko.click();
      await settle();
    }
    [...D.querySelectorAll('.list a.row')].find((r) => r.textContent.includes('Keihäs')).click();
    await settle();
    const openSheetOn = async () => {
      D.querySelector('.cell-name a.athlete-link').click();
      await settle();
      return D.querySelector('.sheet-title').textContent;
    };
    const addBtn = () =>
      [...D.querySelectorAll('.sheet .athlete-sheet .btn')].find((b) => b.textContent.startsWith('Lisää seurantaan'));
    const who = await openSheetOn();
    log(`athlete sheet on: ${who}`);
    // The ▾ promises a menu and marks nothing else (docs/style.md). The
    // sheet's other button has none.
    ok(
      'the sheet offers "Lisää seurantaan" with the menu caret',
      !!addBtn()?.textContent.includes('▾') &&
        !D.querySelector('.athlete-sheet .btn-secondary')?.textContent.includes('▾'),
    );

    // A device with no editToken for a list is its reader, and an add could
    // only answer 403. (Break on purpose: drop the watchEditToken filter in
    // addToWatchMenu, and the list is offered here.)
    const editToken = W.localStorage.getItem(`kisatWatchEdit:${watchId}`);
    W.localStorage.removeItem(`kisatWatchEdit:${watchId}`);
    addBtn().click();
    await settle(); // the roster fetch before the menu opens
    {
      const rows = [...D.querySelectorAll('.sheet .menu .row')];
      log(`menu with no token: ${rows.map((r) => r.querySelector('.row-title').textContent).join(' | ')}`);
      ok(
        'a list this device cannot write to is not offered as somewhere to add',
        rows.length === 1 && rows[0].textContent.includes('Uusi seuranta'),
      );
      // The chip menu's split holds here too. The items are choices, and every
      // row keeps the tick column.
      ok(
        'and it is a menu, not a dialog',
        !D.querySelector('.sheet-menu .btn') && rows.every((r) => !!r.querySelector('.menu-check')),
      );
    }

    // "Uusi seuranta" opens the create sheet with that person on it. It
    // closes the athlete sheet too, as the two are about different subjects.
    [...D.querySelectorAll('.sheet .menu .row')].find((r) => r.textContent.includes('Uusi seuranta')).click();
    await settle();
    const chips = [...D.querySelectorAll('.sheet .watch-picks .watch-chip')].map((c) => c.textContent);
    log(`create sheet opens with: ${chips.join(' | ')}`);
    ok('creating from a name seeds the new list with them', chips.length === 1 && chips[0].includes(who));
    ok('and the athlete sheet went with the menu, leaving one layer', D.querySelectorAll('.sheet').length === 1);
    D.querySelector('.sheet-close').click();
    await settle();
    ok('closing the create sheet leaves nothing behind', !D.querySelector('.sheet'));

    // The add goes into the list this device can write to.
    W.localStorage.setItem(`kisatWatchEdit:${watchId}`, editToken);
    await openSheetOn();
    addBtn().click();
    await settle();
    const target = [...D.querySelectorAll('.sheet .menu .row')].find((r) => r.textContent.includes('Mallikylän Vire'));
    ok('the editable list is offered once the token is back', !!target);
    target.click();
    await settle();
    ok('the add closes both layers', !D.querySelector('.sheet'));
    // The status line names the list the add went into. (Break on purpose:
    // drop the flashMessage, and the render paints "Päivitetty …" over it.)
    log(`status line: ${D.getElementById('updated')?.textContent}`);
    ok(
      'and says which list it went into',
      (D.getElementById('updated')?.textContent || '').includes('Lisätty seurantaan') &&
        (D.getElementById('updated')?.textContent || '').includes('Mallikylän Vire'),
    );
    const stored = await (await W.fetch(`/api/watch/${watchId}`, { headers: { 'x-kisat-client': '1' } })).json();
    log(`stored entries: ${stored.entries.map((e) => `${e.type}:${e.id} ${e.name}`).join(' | ')}`);
    // The PUT carries the whole array, so the club entry survives the add.
    // The entry holds the licence, as this meet's athlete id matches nobody
    // at the next meet (watchEntryForAthlete, lib/watch.js).
    ok(
      'the person is on the list, by licence, beside what was there before',
      stored.entries.length === 2 &&
        stored.entries.some((e) => e.type === 'club') &&
        stored.entries.some((e) => e.type === 'athlete' && e.name === who && /^\d+$/.test(e.id)),
    );

    // The same name is tapped again. Only the active list can show a tick,
    // as its record drew this view (activeWatchSeen, app/data.js). Any other
    // list costs a GET to know, and the tap answers for it.
    const marks = () =>
      [...D.querySelectorAll('.sheet .menu .row')].map(
        (r) => `${r.querySelector('.menu-check').textContent || '·'} ${r.querySelector('.row-title').textContent}`,
      );
    const held = async () => (await W.fetch(`/api/watch/${watchId}`, { headers: { 'x-kisat-client': '1' } })).json();
    await openSheetOn();
    addBtn().click();
    await settle();
    log(`menu after the add: ${marks().join(' | ')}`);
    const ticked = () =>
      [...D.querySelectorAll('.sheet .menu .row')].find((r) => r.textContent.includes('Mallikylän Vire'));
    // (Break on purpose: tick nothing, and the reader has to add someone
    // twice to find out.)
    ok(
      'the list they were just added to is ticked next time',
      ticked().querySelector('.menu-check').textContent === '✓',
    );
    ok(
      'and the tick is the same column "Uusi seuranta" puts its + in',
      marks().some((m) => m.startsWith('+ Uusi seuranta')),
    );
    const was = await held();
    ticked().click();
    await settle();
    const now = await held();
    log(
      `tapping the ticked row: "${D.getElementById('updated')?.textContent}" updatedAt ${was.updatedAt === now.updatedAt ? 'unchanged' : 'moved'}`,
    );
    // A tap with nothing to change says so and writes nothing, as a write
    // moves updatedAt and costs another editor a 409. (Break on purpose: drop
    // the `changed` gate in addToWatch, and both halves fail.)
    ok(
      'tapping it says they are already on, and writes nothing at all',
      (D.getElementById('updated')?.textContent || '').includes('Jo seurannassa') &&
        now.updatedAt === was.updatedAt &&
        now.entries.length === 2,
    );

    // An entry switched off on another device is on the list but hidden. An
    // add still changes it, so the tick asks what an add would change.
    await W.fetch(`/api/watch/${watchId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-kisat-client': '1' },
      body: JSON.stringify({
        editToken,
        label: now.label,
        ifUpdatedAt: now.updatedAt,
        entries: now.entries.map((e) => (e.type === 'athlete' ? { ...e, enabled: false } : e)),
      }),
    });
    appJs.navigate('/c/demo');
    await settle();
    [...D.querySelectorAll('.list a.row')].find((r) => r.textContent.includes('Keihäs')).click();
    await settle();
    await openSheetOn();
    addBtn().click();
    await settle();
    log(`menu with the entry switched off: ${marks().join(' | ')}`);
    // (Break on purpose: tick on presence alone, and the one tap that turns
    // the entry back on reads as a no-op.)
    ok('an entry somebody switched off is not ticked', ticked().querySelector('.menu-check').textContent === '');
    ticked().click();
    await settle();
    const back = await held();
    log(`after tapping it: ${back.entries.map((e) => `${e.type}${e.enabled ? '' : ' (off)'}`).join(' | ')}`);
    // The add turns the entry back on in place. The Worker keeps the first of
    // two entries with one key (normalizeWatchEntries, lib/watch.js). (Break
    // on purpose: append the entry, and the stored one stays off.)
    ok(
      'tapping it puts them back on, in place rather than twice',
      back.entries.length === 2 &&
        back.entries.every((e) => e.enabled !== false) &&
        (D.getElementById('updated')?.textContent || '').includes('Lisätty seurantaan'),
    );
  }

  // --- Two devices, one list ---
  // Every write sends the updatedAt it worked from, and the Worker refuses a
  // stale one (docs/backend.md). The one-tap add and the edit sheet answer
  // that in two ways, and both are here.
  {
    const editToken = W.localStorage.getItem(`kisatWatchEdit:${watchId}`);
    const record = () => W.fetch(`/api/watch/${watchId}`, { headers: { 'x-kisat-client': '1' } }).then((r) => r.json());
    // The other device writes between this one's read and its write.
    const elsewhere = async (entries) => {
      const now = await record();
      await W.fetch(`/api/watch/${watchId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-kisat-client': '1' },
        body: JSON.stringify({ editToken, label: now.label, entries, ifUpdatedAt: now.updatedAt }),
      });
    };

    // The other device takes the added person off. An add with nothing to
    // change writes nothing (watchEntriesWith, lib/watch.js), so the conflict
    // below needs a real write.
    await elsewhere((await record()).entries.filter((e) => e.type !== 'athlete'));

    // The one-tap add re-reads and retries a 409 without a word, as its
    // meaning holds against whatever the list became. The 409 is forced, as a
    // real one needs a write between this device's GET and PUT. (Break on
    // purpose: drop the `attempt === 0` retry, and the reader is told
    // "Lisääminen epäonnistui".)
    const realFetch = W.fetch.bind(W);
    let forced = 0;
    W.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (init?.method === 'PUT' && url.includes(`/api/watch/${watchId}`) && !forced) {
        forced += 1;
        return Promise.resolve(new W.Response('Listaa muutettiin toisaalla.', { status: 409 }));
      }
      return realFetch(input, init);
    };
    D.querySelector('.cell-name a.athlete-link').click();
    await settle();
    [...D.querySelectorAll('.sheet .athlete-sheet .btn')]
      .find((b) => b.textContent.startsWith('Lisää seurantaan'))
      .click();
    await settle();
    [...D.querySelectorAll('.sheet .menu .row')].find((r) => r.textContent.includes('Mallikylän Vire')).click();
    await settle();
    W.fetch = realFetch;
    log(
      `add over a forced conflict: fired=${forced} layers=${D.querySelectorAll('.sheet').length} status="${D.getElementById('updated')?.textContent}"`,
    );
    // Both layers closing says the add succeeded, as a failure leaves the
    // menu open with its message in the row. The status line cannot say it,
    // since the previous block's flash is still in it.
    ok(
      'a conflict the app can resolve by itself is resolved by itself',
      forced === 1 &&
        !D.querySelector('.sheet') &&
        (D.getElementById('updated')?.textContent || '').includes('Lisätty seurantaan'),
    );
    ok(
      'and the person is on the list once, not twice',
      (await record()).entries.filter((e) => e.type === 'athlete').length === 1,
    );

    // The edit sheet holds a whole array, and no rule tells an entry taken off
    // from one not yet added. So the save stops and names what arrived, and a
    // second press saves against the fresh record.
    appJs.navigate('/');
    await settle();
    appJs.navigate('/c/demo');
    await settle();
    [...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('▾')).click();
    await settle();
    [...D.querySelectorAll('.sheet .menu-action')].find((b) => b.textContent === 'Muokkaa').click();
    await settle();
    const chipNames = () =>
      [...D.querySelectorAll('.watch-create .watch-chip')].map((c) => c.textContent.replace('×', '').trim());
    const save = () => [...D.querySelectorAll('.sheet .btn')].find((b) => b.textContent === 'Tallenna').click();
    const notice = () => D.querySelector('.watch-create > .notice')?.textContent || '';
    log(`edit sheet holds: ${chipNames().join(' | ')}`);
    ok('the edit sheet opened on the whole list', chipNames().length === 2);
    // The reader takes one off, which no merge may undo.
    [...D.querySelectorAll('.watch-create .watch-chip')]
      .find((c) => c.textContent.includes('Mallikylän Vire'))
      .querySelector('.watch-chip-remove')
      .click();
    await wait(200);
    // The other device adds one meanwhile.
    const before = (await record()).entries;
    await elsewhere([...before, { type: 'club', id: '3', name: 'Näyteniemen Vauhti', enabled: true }]);
    save();
    await settle();
    log(`conflicted save says: ${notice()}`);
    // (Break on purpose: let the 409 through as an ordinary error, and the
    // sheet merges nothing, so the next press fails again.)
    ok('a conflicted save stops, and stays open', !!D.querySelector('.watch-create'));
    ok(
      '...naming what arrived rather than only that something did',
      notice().includes('Näyteniemen Vauhti') && notice().includes('Tarkista'),
    );
    log(`sheet after the merge: ${chipNames().join(' | ')}`);
    ok('what the other device added is merged into the sheet', chipNames().includes('Näyteniemen Vauhti'));
    ok('and what this reader took off stays off', !chipNames().some((c) => c.includes('Mallikylän Vire')));

    save();
    await settle();
    ok('the second press saves', !D.querySelector('.sheet'));
    const after = (await record()).entries;
    log(`stored after the merged save: ${after.map((e) => `${e.type}:${e.name}`).join(' | ')}`);
    // Neither writer's work is lost. (Break on purpose: keep `base` at the
    // record the sheet opened with, and every press 409s.)
    ok(
      'the addition survives and so does the removal',
      after.length === 2 &&
        after.some((e) => e.name === 'Näyteniemen Vauhti') &&
        after.some((e) => e.type === 'athlete') &&
        !after.some((e) => e.name === 'Mallikylän Vire'),
    );
  }

  // --- The pairing link (keyringLinkHash and keyringPairs, lib/routes.js) ---
  // One hash carries every list this device knows, and a row at the menu's
  // foot copies it.
  {
    // A second real Watch has no token on this device. A list this device
    // only reads travels too, since the other device lists it as well.
    const second = await (
      await W.fetch('/api/watch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-kisat-client': '1' },
        body: JSON.stringify({
          label: 'Vain luettava',
          entries: [{ type: 'club', id: '1', name: 'Demon Urheilijat', enabled: true }],
        }),
      })
    ).json();
    const editToken = W.localStorage.getItem(`kisatWatchEdit:${watchId}`);
    const registry = [
      { watchId, label: 'Mallikylän Vire' },
      { watchId: second.id, label: second.label },
    ];
    const seed = (reg, active) => {
      W.localStorage.setItem('kisatWatches', JSON.stringify(reg));
      if (active) W.localStorage.setItem('kisatFollow', JSON.stringify(active));
      else W.localStorage.removeItem('kisatFollow');
    };
    const goto = async (hash) => {
      appJs.navigate('/');
      await settle();
      appJs.navigate(hash);
      await settle();
    };
    const stored = () => JSON.parse(W.localStorage.getItem('kisatWatches') || '[]');

    seed(registry, watchId);
    await goto('/c/demo');
    [...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('▾')).click();
    await settle();
    const rowLabels = () => [...D.querySelectorAll('.sheet .menu .row-title')].map((r) => r.textContent);
    log(`menu foot: ${rowLabels().slice(-2).join(' | ')}`);
    // Both rows are about the set of lists, so both stand at the foot. (Break
    // on purpose: put either above the lists, and it reads as one to follow.)
    ok('the menu offers the whole registry as one transfer', rowLabels().at(-2) === 'Siirrä toiseen laitteeseen');
    ok('and the other end of one, below it', rowLabels().at(-1) === 'Ota linkki käyttöön');

    // The link keeps the registry's order, with a token only where this
    // device holds one. (Break on purpose: drop the editToken from
    // copyKeyringLink's map, and the link carries no token.)
    const row = [...D.querySelectorAll('.sheet .menu .row')].find(
      (r) => r.querySelector('.row-title')?.textContent === 'Siirrä toiseen laitteeseen',
    );
    const link = new URL(await copiedBy(() => row.click())).hash;
    log(`link: ${link.replace(editToken, '<token>')}`);
    ok('the link carries both lists, one of them tokenless', link === `#/k/${watchId}:${editToken},${second.id}`);

    // The link lands on a device that has seen none of these lists.
    const wipe = () => {
      W.localStorage.removeItem('kisatWatches');
      W.localStorage.removeItem('kisatFollow');
      W.localStorage.removeItem(`kisatWatchEdit:${watchId}`);
      W.localStorage.removeItem(`kisatWatchEdit:${second.id}`);
    };
    wipe();
    await goto(link);
    ok('the pairing link lands on home, since it names no competition', W.location.pathname === '/');
    log(
      `registry after pairing: ${stored()
        .map((r) => r.label)
        .join(' | ')}`,
    );
    // The lists arrive in the link's order, which is the source menu's.
    // (Break on purpose: drop the reverse in activatePairLink, and the two
    // come out swapped.)
    ok(
      'every list is on the new device, in the order the link carried them',
      stored().length === 2 && stored()[0].watchId === watchId && stored()[1].watchId === second.id,
    );
    ok('the label came off the record, not the link', stored()[1].label === 'Vain luettava');
    // The token travels, so the second device can write too. A list the
    // source could not write arrives read-only.
    ok('the write capability travelled with it', W.localStorage.getItem(`kisatWatchEdit:${watchId}`) === editToken);
    ok('and the read-only list arrived read-only', !W.localStorage.getItem(`kisatWatchEdit:${second.id}`));
    ok(
      'a device with nothing active adopts the one the link led with',
      JSON.parse(W.localStorage.getItem('kisatFollow') || 'null') === watchId,
    );
    log(`status line: ${D.getElementById('updated')?.textContent}`);
    ok(
      'and it says how many arrived',
      (D.getElementById('updated')?.textContent || '').includes('2 seurantaa otettu käyttöön'),
    );

    // A pairing link fills the menu and leaves a chosen list on. (Break on
    // purpose: drop the activeFollow() guard, and the link's first list takes
    // over.)
    seed(registry, second.id);
    await goto(link);
    ok(
      'a device that already follows something is not taken over',
      JSON.parse(W.localStorage.getItem('kisatFollow') || 'null') === second.id,
    );

    // A dead id does not cost the reader the rest, as a list can expire on
    // its TTL long after the link was sent. (Break on purpose: fail the
    // landing on the first rejected fetch, and the live list goes with it.)
    wipe();
    await goto(`/#/k/000000000000,${second.id}`);
    ok(
      'a list that no longer exists is dropped, not fatal',
      stored().length === 1 && stored()[0].watchId === second.id,
    );

    // A link where no list answers says why, and home does not open empty.
    wipe();
    await goto('/#/k/000000000000,111111111111');
    ok('a link where nothing answers says so', appText().includes('Yhtään seurantaa ei löytynyt') && !stored().length);

    // With no lists, the menu offers no transfer. (Break on purpose: render
    // the row unconditionally, and it offers a link with nothing in it.)
    seed([], null);
    await goto('/c/demo');
    [...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('▾')).click();
    await settle();
    log(`menu foot with nothing followed: ${rowLabels().slice(-2).join(' | ')}`);
    ok('with no lists there is nothing to transfer', !rowLabels().includes('Siirrä toiseen laitteeseen'));
    // The receiving row stays, as an empty device is the one being set up.
    // (Break on purpose: gate it on known.length like the row above, and a
    // fresh install has no way in.)
    ok('but a link can still be taken into use', rowLabels().at(-1) === 'Ota linkki käyttöön');

    // --- The paste, on this empty device ---
    // An installed app has no address bar, so the link is pasted. It is the
    // link above, so both ends of one transfer are checked against each other.
    [...D.querySelectorAll('.sheet .menu .row')].find((r) => r.textContent.includes('Ota linkki käyttöön')).click();
    await settle();
    const pasteInput = () => D.querySelector('.sheet .watch-create input');
    const pasteBtn = () =>
      [...D.querySelectorAll('.sheet .watch-create button')].find((x) => x.textContent === 'Ota käyttöön');
    log(`paste sheet: ${D.querySelector('.sheet .sheet-title')?.textContent} / input ${!!pasteInput()}`);
    ok(
      'the row opens a sheet with somewhere to paste',
      D.querySelector('.sheet .sheet-title')?.textContent === 'Ota linkki käyttöön' && !!pasteInput(),
    );

    // The sheet reads the input when the button is pressed, so the paste
    // events this probe cannot fire do not matter.
    pasteInput().value = 'moikka! muistatko lähettää sen linkin';
    pasteBtn().click();
    await settle();
    log(
      `after a paste with no link in it: hash ${W.location.pathname}, hint "${D.querySelector('.sheet .sheet-hint')?.textContent}"`,
    );
    // Text with no link leaves the sheet open with the paste in it, as the
    // usual cause is a link cut in half. (Break on purpose: navigate on
    // whatever was pasted, and home opens with nothing taken into use.)
    ok(
      'a paste with no link in it says so and stays put',
      !!pasteInput() &&
        pasteInput().value.startsWith('moikka') &&
        (D.querySelector('.sheet .sheet-hint')?.textContent || '').includes('ei löytynyt seurantalinkkiä') &&
        !stored().length,
    );

    // A link arrives as a whole URL inside a message. (Break on purpose: take
    // the input as the link, skipping pastedLink, and the router answers the
    // words with home and no lists.)
    pasteInput().value = `Tässä ne kaikki: ${W.location.origin}/${link} — terveisin T.`;
    pasteBtn().click();
    await settle();
    log(
      `after pasting the transfer link: hash ${W.location.pathname}, registry ${stored()
        .map((r) => r.label)
        .join(' | ')}`,
    );
    ok(
      'a pasted link lands where the same link tapped would have',
      W.location.pathname === '/' &&
        !D.querySelector('.sheet') &&
        stored().length === 2 &&
        stored()[0].watchId === watchId,
    );
    // The token is what a device cannot get any other way.
    ok('and the write capability came in with it', W.localStorage.getItem(`kisatWatchEdit:${watchId}`) === editToken);
  }

  // --- Deleting a list for everyone ---
  // An edit link cannot be revoked, so deleting the list is the remedy
  // (docs/backend.md). It reaches every device, so it asks first.
  {
    const oneClub = [{ type: 'club', id: '2', name: 'Mallikylän Vire', enabled: true }];
    const make = async (label, entries = oneClub) =>
      (
        await W.fetch('/api/watch', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-kisat-client': '1' },
          body: JSON.stringify({ label, entries }),
        })
      ).json();
    const alive = async (id) =>
      (await W.fetch(`/api/watch/${id}`, { headers: { 'x-kisat-client': '1' } })).status === 200;
    // Sets up a device holding exactly `tokens`, with `active` selected, as
    // the menu's actions render only under the selected row.
    const openMenuOn = async (reg, active, tokens) => {
      for (const k of Object.keys(W.localStorage)) {
        if (k.startsWith('kisatWatchEdit:')) W.localStorage.removeItem(k);
      }
      W.localStorage.setItem('kisatWatches', JSON.stringify(reg));
      W.localStorage.setItem('kisatFollow', JSON.stringify(active));
      for (const [id, token] of Object.entries(tokens)) W.localStorage.setItem(`kisatWatchEdit:${id}`, token);
      appJs.navigate('/');
      await settle();
      appJs.navigate('/c/demo');
      await settle();
      [...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('▾')).click();
      await settle();
    };
    const actions = () => [...D.querySelectorAll('.sheet .menu-action')].map((b) => b.textContent);
    const press = (text) =>
      [...D.querySelectorAll('.sheet .menu-action, .sheet .btn')].find((b) => b.textContent === text).click();
    const registry = () => JSON.parse(W.localStorage.getItem('kisatWatches') || '[]');

    // A reader cannot destroy what they cannot write. (Break on purpose:
    // offer the row without a token, and it can only answer 403.)
    const readOnly = await make('Vain luettava 3');
    await openMenuOn([{ watchId: readOnly.id, label: readOnly.label }], readOnly.id, {});
    log(`actions without a token: ${actions().join(' · ')}`);
    ok(
      'a list this device can only read offers no way to destroy it',
      actions().includes('Jaa linkki') && !actions().includes('Poista kaikilta'),
    );

    const doomed = await make('Poistettava');
    await openMenuOn([{ watchId: doomed.id, label: doomed.label }], doomed.id, { [doomed.id]: doomed.editToken });
    log(`actions with a token: ${actions().join(' · ')}`);
    ok('where the token is, the whole remedy is offered too', actions().at(-1) === 'Poista kaikilta');

    // The question is a dialog, with prose and a named way out (docs/style.md).
    press('Poista kaikilta');
    await wait(400);
    log(`confirm sheet: ${D.querySelector('.sheet .help-text')?.textContent}`);
    ok(
      'it asks first, naming the list and who else loses it',
      (D.querySelector('.sheet .help-text')?.textContent || '').includes('"Poistettava"') &&
        (D.querySelector('.sheet .help-text')?.textContent || '').includes('jakanut linkin'),
    );
    press('Peruuta');
    await wait(300);
    ok('Peruuta destroys nothing', !D.querySelector('.sheet') && (await alive(doomed.id)) && registry().length === 1);

    // (Break on purpose: forgetWatch without the DELETE, and the list stays
    // for everyone the link reached.)
    [...D.querySelectorAll('.filter-bar button')].find((b) => b.textContent.includes('▾')).click();
    await settle();
    press('Poista kaikilta');
    await wait(400);
    press('Poista lopullisesti');
    await settle();
    log(
      `after the delete: layers=${D.querySelectorAll('.sheet').length} status="${D.getElementById('updated')?.textContent}"`,
    );
    ok('the record is gone for everyone with the link', !(await alive(doomed.id)));
    ok(
      'and the device says which list went',
      (D.getElementById('updated')?.textContent || '').includes('Seuranta "Poistettava" poistettu'),
    );
    ok(
      'the row went with it, and so did the token',
      !registry().length && !W.localStorage.getItem(`kisatWatchEdit:${doomed.id}`),
    );
    ok(
      'nothing is followed any more, and the bar says so',
      !JSON.parse(W.localStorage.getItem('kisatFollow') || 'null') &&
        [...D.querySelectorAll('.filter-bar button')].some((b) => b.textContent.includes('Ei seurantaa')),
    );

    // A list already deleted elsewhere is the state asked for, so this device
    // tidies up. (Break on purpose: treat the 404 as a failure, and the list
    // can never be cleared off this device.)
    await openMenuOn([{ watchId: doomed.id, label: doomed.label }], doomed.id, { [doomed.id]: doomed.editToken });
    press('Poista kaikilta');
    await wait(400);
    press('Poista lopullisesti');
    await settle();
    ok(
      'a list already gone from elsewhere still leaves this device clean',
      !D.querySelector('.sheet') && !registry().length,
    );

    // A token that is not the Watch's comes from a damaged edit link. Nothing
    // is destroyed, and the token is dropped. (Break on purpose: keep the
    // token, and the menu goes on offering "Muokkaa" and "Poista kaikilta".)
    await openMenuOn([{ watchId: readOnly.id, label: readOnly.label }], readOnly.id, { [readOnly.id]: 'not-it' });
    press('Poista kaikilta');
    await wait(400);
    press('Poista lopullisesti');
    await settle();
    const btnText = [...D.querySelectorAll('.sheet .btn')].map((b) => b.textContent);
    log(`after a refused delete: ${btnText.join(' · ')}`);
    ok(
      'a wrong token destroys nothing and says so on the button',
      !!D.querySelector('.sheet') && btnText.includes('Muokkauslinkki ei kelpaa enää') && (await alive(readOnly.id)),
    );
    ok(
      'the claim is dropped, the list is not',
      !W.localStorage.getItem(`kisatWatchEdit:${readOnly.id}`) && registry().length === 1,
    );

    // --- Copying somebody else's list, on this block's helpers ---
    // A share link grants reading alone (docs/backend.md, "Watches"), so a
    // recipient changes only a list of their own with the same people on it.
    const shared = await make('Naapurin lista', [
      { type: 'club', id: '2', name: 'Mallikylän Vire', enabled: true },
      { type: 'club', id: '1', name: 'Demon Urheilijat', enabled: false },
    ]);
    await openMenuOn([{ watchId: shared.id, label: shared.label }], shared.id, {});
    log(`read-only actions: ${actions().join(' · ')}`);
    // "Muokkaa" and the copy answer one question, so exactly one is offered.
    // (Break on purpose: offer "Muokkaa" without a token, and it shows here.)
    ok(
      'a list this device cannot write offers a copy in "Muokkaa"\'s place',
      actions()[0] === 'Kopioi omaksi seurannaksi' && !actions().includes('Muokkaa'),
    );

    const labelInput = () => D.querySelector('.sheet .watch-create input[type="text"]');
    const chips = () => [...D.querySelectorAll('.sheet .watch-chip')];
    press('Kopioi omaksi seurannaksi');
    await settle();
    log(
      `copy sheet: "${labelInput()?.value}" / ${chips()
        .map((c) => c.textContent)
        .join(', ')}`,
    );
    // Both lists stay in the menu, so the copy takes a name of its own. (Break
    // on purpose: pass the label through unchanged, and two rows read alike.)
    ok('the copy opens named apart from the list it came from', labelInput()?.value === 'Naapurin lista (kopio)');
    ok(
      "carrying the sharer's people, the switched-off one included",
      chips().length === 2 && chips()[1].classList.contains('watch-chip-off'),
    );
    // (Break on purpose: drop `editing: true`, and an entry the sharer
    // switched off can only be removed here.)
    ok(
      'and every one of them can be flipped, not just removed',
      chips().every((c) => !!c.querySelector('input[type="checkbox"]')),
    );

    chips()[1].querySelector('input[type="checkbox"]').click();
    await wait(200);
    press('Luo kopio');
    await settle();
    const copyId = JSON.parse(W.localStorage.getItem('kisatFollow') || 'null');
    const copyToken = W.localStorage.getItem(`kisatWatchEdit:${copyId}`);
    log(
      `after the copy: follow=${copyId} rows=${registry()
        .map((r) => r.label)
        .join(' | ')}`,
    );
    ok(
      'the copy is a record of its own, and this device holds its token',
      copyId && copyId !== shared.id && !!copyToken,
    );
    // (Break on purpose: forget the original while copying, and the reader
    // loses the list they were sent.)
    ok(
      'both lists are in the menu — copying forgets nothing',
      registry().length === 2 && registry().some((r) => r.watchId === shared.id),
    );
    const copied = await (await W.fetch(`/api/watch/${copyId}`, { headers: { 'x-kisat-client': '1' } })).json();
    log(`copied entries: ${JSON.stringify(copied.entries)}`);
    ok(
      'with the same people on it, as the reader left them',
      copied.entries.length === 2 && copied.entries.every((e) => e.enabled),
    );

    // A second copy takes a name past the first. (Break on purpose: pass no
    // registry labels to copyWatchLabel, and it reads "(kopio)".)
    await openMenuOn(registry(), shared.id, { [copyId]: copyToken });
    press('Kopioi omaksi seurannaksi');
    await settle();
    log(`second copy would be named: "${labelInput()?.value}"`);
    ok('a second copy is named past the first', labelInput()?.value === 'Naapurin lista (kopio 2)');
    D.querySelector('.sheet-close').click();
    await wait(200);

    // The copy is the reader's own, with the writes on its menu. (Break on
    // purpose: offer the copy unconditionally, and it stays on this menu.)
    await openMenuOn(registry(), copyId, { [copyId]: copyToken });
    log(`actions on the copy: ${actions().join(' · ')}`);
    ok(
      'and this device can change what it now owns',
      actions()[0] === 'Muokkaa' && !actions().includes('Kopioi omaksi seurannaksi'),
    );

    // A copy outlives its original, so "Poista kaikilta" spares the people a
    // list was shared with. (Break on purpose: nothing server-side links the
    // two, and this check catches a link being added.)
    await W.fetch(`/api/watch/${shared.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-kisat-client': '1' },
      body: JSON.stringify({ editToken: shared.editToken }),
    });
    ok('a copy outlives the list it came from', !(await alive(shared.id)) && (await alive(copyId)));
  }
}
