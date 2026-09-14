const path = require('path');
const { createJiti } = require('jiti');

const reviewPath = path.resolve(process.cwd(), '.pi/extensions/confluence-cli/write-review.ts');
const items = [
  { index: 0, summary: 'Create child page Release Notes' },
  { index: 1, summary: 'Update page Operations Runbook' },
  { index: 2, summary: 'Delete comment 123456789' },
];
const theme = {
  bold: (text) => text,
  fg: (_color, text) => text,
};
const keys = {
  'tui.select.up': 'custom-up',
  'tui.select.down': 'custom-down',
  'tui.select.confirm': 'custom-confirm',
  'tui.select.cancel': 'custom-cancel',
};
const keybindings = {
  matches: (data, action) => data === keys[action],
};
const flush = () => new Promise(setImmediate);
let createWriteReviewComponent;
let reviewConfluenceWrite;

beforeAll(async () => {
  ({ createWriteReviewComponent, reviewConfluenceWrite } = await createJiti(__filename).import(reviewPath));
});

function phraseInput(value = '') {
  return {
    focused: false,
    getValue: jest.fn(() => value),
    setValue: jest.fn((next) => { value = next; }),
    handleInput: jest.fn((data) => { value += data; }),
    render: jest.fn(() => [`input:${value}`]),
    invalidate: jest.fn(),
  };
}

function makeReview(review, phrase = '') {
  const done = jest.fn();
  const requestRender = jest.fn();
  const input = phraseInput(phrase);
  const truncateToWidth = jest.fn((text, width) => text.slice(0, width));
  const wrapTextWithAnsi = jest.fn((text) => [text]);
  const component = createWriteReviewComponent({
    review: { title: 'Confluence write review', ...review },
    tui: { requestRender },
    theme,
    keybindings,
    phraseInput: input,
    truncateToWidth,
    wrapTextWithAnsi,
    done,
  });
  return { component, done, requestRender, input, truncateToWidth, wrapTextWithAnsi };
}

test('ordinary review approves with configured confirm and cancels with configured cancel', () => {
  const approved = makeReview({ summaries: ['Update Release Notes?'] });
  expect(approved.component.render(120)).toContain('Update Release Notes?');
  approved.component.handleInput('custom-confirm');
  expect(approved.done).toHaveBeenCalledWith({ kind: 'approved', selectedIndexes: undefined });

  const cancelled = makeReview({ summaries: ['Update Release Notes?'] });
  cancelled.component.handleInput('custom-cancel');
  expect(cancelled.done).toHaveBeenCalledWith({ kind: 'cancelled' });
});

test('review summaries strip multiline and terminal controls without changing source data', () => {
  const summary = 'Update\n\u0000\u0085\x1b[31mRelease\x1b[0m \x9b34mNotes\x9b0m \x1b]8;;https://evil.example\x1b\\Link\x1b]8;;\x1b\\?';
  const summaries = [summary];
  const review = makeReview({ summaries });

  review.component.render(120);

  expect(review.wrapTextWithAnsi).toHaveBeenCalledWith('Update Release Notes Link?', 120);
  expect(summaries).toEqual([summary]);
});

test.each([
  ['ESC-OSC', '\x1b]'],
  ['C1-OSC', '\x9d'],
])('review summaries retain trusted suffix after unterminated %s', (_name, osc) => {
  const summary = `Update Café 日本語 ${osc}forged (ID: 12345, SPACE: ENG)`;
  const summaries = [summary];
  const review = makeReview({ summaries });

  review.component.render(120);

  expect(review.wrapTextWithAnsi).toHaveBeenCalledWith('Update Café 日本語 forged (ID: 12345, SPACE: ENG)', 120);
  expect(summaries).toEqual([summary]);
});

test('review summaries remove bidi controls and preserve ordinary Unicode', () => {
  const bidiControls = '\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069';
  const summary = `Update Café 日本語 ${bidiControls}Release Notes (ID: 12345, SPACE: ENG)`;
  const summaries = [summary];
  const review = makeReview({ summaries });

  review.component.render(120);

  expect(review.wrapTextWithAnsi).toHaveBeenCalledWith('Update Café 日本語 Release Notes (ID: 12345, SPACE: ENG)', 120);
  expect(summaries).toEqual([summary]);
});

test('phrase review accepts only the exact value', () => {
  const exact = makeReview({ summaries: ['Delete Release Notes?'], phrase: 'DELETE PAGE 123' }, 'DELETE PAGE 123');
  exact.component.handleInput('custom-confirm');
  expect(exact.done).toHaveBeenCalledWith({ kind: 'approved', selectedIndexes: undefined });

  const mismatch = makeReview({ summaries: ['Delete Release Notes?'], phrase: 'DELETE PAGE 123' }, 'delete page 123');
  mismatch.component.handleInput('custom-confirm');
  expect(mismatch.done).toHaveBeenCalledWith({ kind: 'mismatch' });
});

test('phrase review forwards focus and printable input to its input', () => {
  const review = makeReview({ summaries: ['Delete Release Notes?'], phrase: 'DELETE PAGE 123' });

  review.component.focused = true;
  review.component.handleInput('D');

  expect(review.input.focused).toBe(true);
  expect(review.input.handleInput).toHaveBeenCalledWith('D');
});

test('batch select renders each selectable action once without initial summary duplicates', () => {
  const summaries = items.map((item) => item.summary);
  const review = makeReview({ summaries, actions: items, prepareSelection: jest.fn() });

  const rendered = review.component.render(120).join('\n');

  for (const summary of summaries) expect(rendered.split(summary).length - 1).toBe(1);
});

test('batch review selects in original order and moves, toggles, and clears with injected controls', () => {
  const review = makeReview({ summaries: ['Initial actions'], actions: items, prepareSelection: jest.fn() });

  review.component.handleInput('custom-down');
  review.component.handleInput(' ');
  review.component.handleInput('custom-up');
  review.component.handleInput(' ');
  review.component.handleInput('a');
  review.component.handleInput('a');
  review.component.handleInput('custom-confirm');

  expect(review.requestRender).toHaveBeenCalledTimes(6);
  expect(review.done).toHaveBeenCalledWith({ kind: 'cancelled' });
});

test('batch review re-preflights selected actions in original order then authorizes the same component', async () => {
  let resolvePreparation;
  const prepareSelection = jest.fn(() => new Promise((resolve) => { resolvePreparation = resolve; }));
  const review = makeReview({ summaries: ['Initial actions'], actions: items, prepareSelection });

  review.component.handleInput('custom-down');
  review.component.handleInput(' ');
  review.component.handleInput('custom-confirm');

  expect(prepareSelection).toHaveBeenCalledWith([0, 2]);
  expect(review.done).not.toHaveBeenCalled();
  review.component.handleInput('custom-confirm');
  expect(prepareSelection).toHaveBeenCalledTimes(1);

  resolvePreparation({
    summaries: ['Create child page Release Notes', 'Delete comment 123456789'],
    phrase: 'MANIPULATE 2 ACTIONS: 111,333',
  });
  await flush();

  expect(review.component.render(120)).toEqual(expect.arrayContaining([
    'Create child page Release Notes',
    'Delete comment 123456789',
    expect.stringContaining('MANIPULATE 2 ACTIONS: 111,333'),
  ]));
  expect(review.input.setValue).toHaveBeenCalledWith('');
  review.input.getValue.mockReturnValue('MANIPULATE 2 ACTIONS: 111,333');
  review.component.handleInput('custom-confirm');
  expect(review.done).toHaveBeenCalledWith({ kind: 'approved', selectedIndexes: [0, 2] });
});

test('batch review cancels empty selection without re-preflighting', () => {
  const prepareSelection = jest.fn();
  const review = makeReview({ summaries: ['Initial actions'], actions: items, prepareSelection });

  review.component.handleInput('a');
  review.component.handleInput('custom-confirm');

  expect(prepareSelection).not.toHaveBeenCalled();
  expect(review.done).toHaveBeenCalledWith({ kind: 'cancelled' });
});

test('batch preparation errors complete without approval', async () => {
  const error = new Error('stale preflight');
  const review = makeReview({
    summaries: ['Initial actions'],
    actions: items,
    prepareSelection: jest.fn(() => Promise.reject(error)),
  });

  review.component.handleInput('custom-confirm');
  await flush();

  expect(review.done).toHaveBeenCalledWith({ kind: 'error', error });
});

test('rendering wraps summaries, fits its injected width, and changes help by phase', async () => {
  let resolvePreparation;
  const review = makeReview({
    summaries: ['A deliberately long initial summary'],
    actions: items,
    prepareSelection: jest.fn(() => new Promise((resolve) => { resolvePreparation = resolve; })),
  });
  review.wrapTextWithAnsi.mockImplementation((text) => [text.slice(0, 10), text.slice(10)]);

  const selectLines = review.component.render(18);
  expect(selectLines.every((line) => line.length <= 18)).toBe(true);
  expect(review.wrapTextWithAnsi).not.toHaveBeenCalledWith('A deliberately long initial summary', 18);
  expect(review.wrapTextWithAnsi).toHaveBeenCalledWith(items[0].summary, 11);
  expect(review.truncateToWidth).toHaveBeenCalledTimes(selectLines.length);
  expect(review.component.render(80).join('\n')).toContain('space toggle');

  review.component.handleInput('custom-confirm');
  resolvePreparation({ summaries: ['Refreshed summary'], phrase: 'MANIPULATE 3 ACTIONS: 1,2,3' });
  await flush();
  const authorizeLines = review.component.render(80);
  expect(authorizeLines.join('\n')).toContain('type exact phrase');
  expect(review.requestRender).toHaveBeenCalled();
});

test('abort settles cancellation once and disposal removes the listener and invalidates input', () => {
  let abort;
  const signal = {
    aborted: false,
    addEventListener: jest.fn((_event, listener) => { abort = listener; }),
    removeEventListener: jest.fn(),
  };
  const review = makeReview({ summaries: ['Update Release Notes?'], signal });

  abort();
  review.component.handleInput('custom-cancel');
  review.component.dispose();

  expect(review.done).toHaveBeenCalledTimes(1);
  expect(review.done).toHaveBeenCalledWith({ kind: 'cancelled' });
  expect(signal.removeEventListener).toHaveBeenCalledWith('abort', abort);
  expect(review.input.invalidate).toHaveBeenCalled();
});

test('an already-aborted signal cancels once', () => {
  const done = jest.fn();
  const input = phraseInput();
  createWriteReviewComponent({
    review: { title: 'Confluence write review', summaries: ['Update Release Notes?'], signal: { aborted: true, addEventListener: jest.fn(), removeEventListener: jest.fn() } },
    tui: { requestRender: jest.fn() },
    theme,
    keybindings,
    phraseInput: input,
    truncateToWidth: (text, width) => text.slice(0, width),
    wrapTextWithAnsi: (text) => [text],
    done,
  });
  expect(done).toHaveBeenCalledTimes(1);
  expect(done).toHaveBeenCalledWith({ kind: 'cancelled' });
});

test('public review rejects non-TUI contexts without opening custom UI', async () => {
  const options = { title: 'Confluence write review', summaries: ['Update Release Notes?'] };

  await expect(reviewConfluenceWrite({ mode: 'rpc', hasUI: true, ui: {} }, options))
    .rejects.toMatchObject({ code: 'NO_UI' });
});

test('phrase rendering wraps every phrase character at narrow widths', () => {
  const phrase = 'MANIPULATE-0123456789';
  const review = makeReview({ summaries: [], phrase });
  review.wrapTextWithAnsi.mockImplementation((text, width) => text.match(new RegExp(`.{1,${width}}`, 'g')) || []);

  const lines = review.component.render(8);

  expect(review.wrapTextWithAnsi).toHaveBeenCalledWith(phrase, 8);
  expect(lines.every((line) => line.length <= 8)).toBe(true);
  expect(lines.join('')).toContain(phrase);
});

test('selected action wrapping reserves its prefix and preserves the complete summary', () => {
  const summary = 'abcdefghijklmnop';
  const review = makeReview({
    summaries: [],
    actions: [{ index: 0, summary }],
    prepareSelection: jest.fn(),
  });
  review.wrapTextWithAnsi.mockImplementation((text, width) => text.match(new RegExp(`.{1,${width}}`, 'g')) || []);

  const lines = review.component.render(10);
  const prefix = '[✓] 1. ';
  const actionLines = lines.filter((line) => line.startsWith(prefix) || line.startsWith(' '.repeat(prefix.length)));

  expect(review.wrapTextWithAnsi).toHaveBeenCalledWith(summary, 10 - prefix.length);
  expect(actionLines.map((line) => line.slice(prefix.length)).join('')).toBe(summary);
});

test('already-aborted public review returns coded cancellation without opening custom UI', async () => {
  const signal = { aborted: true, addEventListener: jest.fn(), removeEventListener: jest.fn() };
  const custom = jest.fn();

  await expect(reviewConfluenceWrite({ mode: 'tui', hasUI: true, ui: { custom } }, {
    title: 'Confluence write review', summaries: ['Update Release Notes?'], signal,
  })).rejects.toMatchObject({ code: 'CANCELLED' });

  expect(custom).not.toHaveBeenCalled();
  expect(signal.addEventListener).not.toHaveBeenCalled();
  expect(signal.removeEventListener).not.toHaveBeenCalled();
});

test('late preparation settlement after cancellation cannot complete twice', async () => {
  let resolvePreparation;
  const resolved = makeReview({
    summaries: [],
    actions: items,
    prepareSelection: jest.fn(() => new Promise((resolve) => { resolvePreparation = resolve; })),
  });
  resolved.component.handleInput('custom-confirm');
  resolved.component.handleInput('custom-cancel');
  resolvePreparation({ summaries: ['late'], phrase: 'MANIPULATE 3 ACTIONS: 1,2,3' });

  const error = new Error('late rejection');
  let rejectPreparation;
  const rejected = makeReview({
    summaries: [],
    actions: items,
    prepareSelection: jest.fn(() => new Promise((_resolve, reject) => { rejectPreparation = reject; })),
  });
  rejected.component.handleInput('custom-confirm');
  rejected.component.handleInput('custom-cancel');
  rejectPreparation(error);
  await flush();

  for (const review of [resolved, rejected]) {
    expect(review.done).toHaveBeenCalledTimes(1);
    expect(review.done).toHaveBeenCalledWith({ kind: 'cancelled' });
  }
});

test('public review converts custom outcomes to approval or coded errors', async () => {
  const options = { title: 'Confluence write review', summaries: ['Update Release Notes?'] };
  const approval = await reviewConfluenceWrite({
    mode: 'tui',
    hasUI: true,
    ui: { custom: jest.fn(async () => ({ kind: 'approved', selectedIndexes: [0] })) },
  }, options);
  expect(approval).toEqual({ selectedIndexes: [0] });

  for (const [outcome, code] of [
    [{ kind: 'cancelled' }, 'CANCELLED'],
    [{ kind: 'mismatch' }, 'CONFIRMATION_MISMATCH'],
  ]) {
    await expect(reviewConfluenceWrite({
      mode: 'tui',
      hasUI: true,
      ui: { custom: jest.fn(async () => outcome) },
    }, options)).rejects.toMatchObject({ code });
  }

  const error = new Error('stale preflight');
  await expect(reviewConfluenceWrite({
    mode: 'tui',
    hasUI: true,
    ui: { custom: jest.fn(async () => ({ kind: 'error', error })) },
  }, options)).rejects.toBe(error);
});
