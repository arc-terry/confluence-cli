import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { sanitizeConfluencePresentation } from './tool-renderer.ts';

export type ReviewItem = Readonly<{ index: number; summary: string }>;
export type PreparedReview = Readonly<{ summaries: readonly string[]; phrase: string }>;
export type ReviewApproval = Readonly<{ selectedIndexes?: readonly number[] }>;
export type ReviewOutcome =
  | Readonly<{ kind: 'approved'; selectedIndexes?: readonly number[] }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'mismatch' }>
  | Readonly<{ kind: 'error'; error: unknown }>;

export type WriteReviewOptions = Readonly<{
  title: string;
  summaries: readonly string[];
  phrase?: string;
  actions?: readonly ReviewItem[];
  signal?: AbortSignal;
  prepareSelection?: (indexes: readonly number[]) => Promise<PreparedReview>;
}>;

export type PhraseInput = {
  focused: boolean;
  getValue(): string;
  setValue(value: string): void;
  handleInput(data: string): void;
  render(width: number): string[];
  invalidate(): void;
};

type Theme = {
  bold: (text: string) => string;
  fg: (color: string, text: string) => string;
};
type SelectionKey = 'tui.select.up' | 'tui.select.down' | 'tui.select.confirm' | 'tui.select.cancel';
type Keybindings = { matches: (data: string, action: SelectionKey) => boolean };
type Focusable = { focused: boolean; handleInput(data: string): void; render(width: number): string[] };
type ReviewPhase = 'select' | 'preparing' | 'authorize';
type ReviewContext = {
  mode: string;
  hasUI?: boolean;
  ui?: {
    custom?: <T>(factory: (
      tui: { requestRender(): void },
      theme: Theme,
      keybindings: Keybindings,
      done: (outcome: T) => void,
    ) => Promise<WriteReviewComponent> | WriteReviewComponent) => Promise<T>;
  };
};

export class WriteReviewComponent implements Focusable {
  private cursor = 0;
  private phase: ReviewPhase;
  private summaries: readonly string[];
  private phrase: string | undefined;
  private selectedIndexes: readonly number[] | undefined;
  private settled = false;
  private readonly selected: Set<number>;
  private readonly abort: () => void;

  constructor(private readonly options: {
    review: WriteReviewOptions;
    tui: { requestRender(): void };
    theme: Theme;
    keybindings: Keybindings;
    phraseInput: PhraseInput;
    truncateToWidth: (text: string, width: number) => string;
    wrapTextWithAnsi: (text: string, width: number) => string[];
    done(outcome: ReviewOutcome): void;
  }) {
    this.phase = options.review.actions ? 'select' : 'authorize';
    this.summaries = options.review.summaries;
    this.phrase = options.review.phrase;
    this.selected = new Set(options.review.actions?.map((item) => item.index));
    this.abort = () => this.finish({ kind: 'cancelled' });
    if (options.review.signal?.aborted) this.abort();
    else options.review.signal?.addEventListener('abort', this.abort, { once: true });
  }

  get focused(): boolean {
    return this.options.phraseInput.focused;
  }

  set focused(value: boolean) {
    this.options.phraseInput.focused = value;
  }

  handleInput(data: string): void {
    if (this.settled) return;
    if (this.options.keybindings.matches(data, 'tui.select.cancel')) {
      this.finish({ kind: 'cancelled' });
      return;
    }
    if (this.phase === 'select') {
      this.handleSelectionInput(data);
      return;
    }
    if (this.phase === 'preparing') return;
    if (this.options.keybindings.matches(data, 'tui.select.confirm')) {
      if (this.phrase !== undefined && this.options.phraseInput.getValue() !== this.phrase) {
        this.finish({ kind: 'mismatch' });
      } else {
        this.finish({ kind: 'approved', selectedIndexes: this.selectedIndexes });
      }
      return;
    }
    if (this.phrase !== undefined) {
      this.options.phraseInput.handleInput(data);
      this.changed();
    }
  }

  render(width: number): string[] {
    const summaries = this.phase === 'authorize'
      ? this.summaries.flatMap((summary) => this.summaryLines(summary, width))
      : [];
    const lines = [
      this.options.theme.fg('accent', `┌ ${this.options.theme.bold(this.options.review.title)}`),
      ...summaries,
      ...this.phaseLines(width),
      '└',
    ];
    return lines.map((line) => this.options.truncateToWidth(line, width));
  }

  invalidate(): void {
    this.options.phraseInput.invalidate();
  }

  dispose(): void {
    this.options.review.signal?.removeEventListener('abort', this.abort);
    this.options.phraseInput.invalidate();
  }

  private handleSelectionInput(data: string): void {
    const actions = this.options.review.actions ?? [];
    if (this.options.keybindings.matches(data, 'tui.select.up') && this.cursor > 0) {
      this.cursor--;
      this.changed();
    } else if (this.options.keybindings.matches(data, 'tui.select.down') && this.cursor < actions.length - 1) {
      this.cursor++;
      this.changed();
    } else if (data === ' ' && actions[this.cursor]) {
      const index = actions[this.cursor].index;
      this.selected.has(index) ? this.selected.delete(index) : this.selected.add(index);
      this.changed();
    } else if (data === 'a' && actions.length) {
      if (this.selected.size === actions.length) this.selected.clear();
      else actions.forEach((item) => this.selected.add(item.index));
      this.changed();
    } else if (this.options.keybindings.matches(data, 'tui.select.confirm')) {
      const indexes = actions.filter((item) => this.selected.has(item.index)).map((item) => item.index);
      if (!indexes.length) {
        this.finish({ kind: 'cancelled' });
      } else {
        this.prepare(indexes);
      }
    }
  }

  private prepare(indexes: readonly number[]): void {
    const prepareSelection = this.options.review.prepareSelection;
    if (!prepareSelection) {
      this.finish({ kind: 'error', error: new Error('prepareSelection is required for selectable actions') });
      return;
    }
    this.phase = 'preparing';
    this.changed();
    let preparation: Promise<PreparedReview>;
    try {
      preparation = prepareSelection(indexes);
    } catch (error) {
      this.finish({ kind: 'error', error });
      return;
    }
    Promise.resolve(preparation).then((prepared) => {
      if (this.settled) return;
      this.summaries = prepared.summaries;
      this.phrase = prepared.phrase;
      this.selectedIndexes = indexes;
      this.phase = 'authorize';
      this.options.phraseInput.setValue('');
      this.changed();
    }, (error: unknown) => this.finish({ kind: 'error', error }));
  }

  private phaseLines(width: number): string[] {
    const actions = this.options.review.actions ?? [];
    if (this.phase === 'select') {
      return [
        '',
        ...actions.flatMap((item, row) => {
          const prefix = `[${this.selected.has(item.index) ? '✓' : ' '}] ${item.index + 1}. `;
          const indent = ' '.repeat(prefix.length);
          const summaryWidth = width > prefix.length ? width - prefix.length : width;
          const summaryLines = this.summaryLines(item.summary, summaryWidth);
          const lines = width > prefix.length ? summaryLines.map((summary, line) => `${line ? indent : prefix}${summary}`) : [prefix, ...summaryLines];
          return row === this.cursor ? lines.map((line) => this.options.theme.fg('accent', line)) : lines;
        }),
        '',
        this.options.theme.fg('muted', `Selected: ${this.selected.size} of ${actions.length}`),
        this.options.theme.fg('dim', '↑↓ navigate • space toggle • a all • enter continue • esc cancel'),
      ];
    }
    if (this.phase === 'preparing') {
      return [this.options.theme.fg('muted', 'Preparing selected actions…'), this.options.theme.fg('dim', 'esc cancel')];
    }
    if (this.phrase !== undefined) {
      return [
        this.options.theme.fg('warning', 'Type exact phrase:'),
        ...this.options.wrapTextWithAnsi(this.phrase, width),
        ...this.options.phraseInput.render(width),
        this.options.theme.fg('dim', 'type exact phrase • enter confirm • esc cancel'),
      ];
    }
    return [this.options.theme.fg('dim', 'enter approve • esc cancel')];
  }

  private summaryLines(summary: string, width: number): string[] {
    const displayed = sanitizeConfluencePresentation(summary);
    return displayed ? this.options.wrapTextWithAnsi(displayed, width) : [];
  }

  private changed(): void {
    this.invalidate();
    this.options.tui.requestRender();
  }

  private finish(outcome: ReviewOutcome): void {
    if (this.settled) return;
    this.settled = true;
    this.options.done(outcome);
  }
}

export function createWriteReviewComponent(options: {
  review: WriteReviewOptions;
  tui: { requestRender(): void };
  theme: Theme;
  keybindings: Keybindings;
  phraseInput: PhraseInput;
  truncateToWidth(text: string, width: number): string;
  wrapTextWithAnsi(text: string, width: number): string[];
  done(outcome: ReviewOutcome): void;
}): WriteReviewComponent {
  return new WriteReviewComponent(options);
}

function codedError(code: 'CANCELLED' | 'CONFIRMATION_MISMATCH' | 'NO_UI'): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

export async function reviewConfluenceWrite(ctx: ExtensionContext, options: WriteReviewOptions): Promise<ReviewApproval> {
  const reviewContext = ctx as ExtensionContext & ReviewContext;
  if (reviewContext.mode !== 'tui' || reviewContext.hasUI !== true || typeof reviewContext.ui?.custom !== 'function') throw codedError('NO_UI');
  if (options.signal?.aborted) throw codedError('CANCELLED');
  const outcome = await reviewContext.ui.custom<ReviewOutcome>(async (tui, theme, keybindings, done) => {
    const { Input, truncateToWidth, wrapTextWithAnsi } = await import('@earendil-works/pi-tui');
    return createWriteReviewComponent({
      review: options,
      tui,
      theme,
      keybindings,
      phraseInput: new Input() as PhraseInput,
      truncateToWidth,
      wrapTextWithAnsi,
      done,
    });
  });
  if (outcome.kind === 'approved') return { selectedIndexes: outcome.selectedIndexes };
  if (outcome.kind === 'error') throw outcome.error;
  throw codedError(outcome.kind === 'mismatch' ? 'CONFIRMATION_MISMATCH' : 'CANCELLED');
}
