import { Editor, MarkdownView, Plugin } from 'obsidian';
import { foldedRanges, foldEffect, unfoldEffect, foldable } from '@codemirror/language';
//This plugin works with CM6 directly since folding is not exposed through Editor API
//keymap + Prec for keybinding with a specific priority
import { keymap, EditorView } from '@codemirror/view';
import { Prec, StateEffect } from '@codemirror/state';

interface FoldRange {
	from: number;
	to: number;
}

interface CopiedFoldInfo {
	startLine: number;
	folds: FoldRange[];
}

//Two Main features:
//  1. Paste-preserves-fold-state: copying a folded section and pasting
//  	it elsewhere restores its folded headings, overriding Obsidian's
//    	default behavior of unfolding everything on paste.
//  2. Toggle-fold-in-selection: fold or unfold every heading inside
//       the current text selection with one keybind/command.


export default class PaperClipPlugin extends Plugin {
	// Snapshot of fold state taken at copy-time. Single-slot (not a
	// map/stack) since Obsidian only tracks one active clipboard
	// selection at a time.
	private copiedFoldInfo: CopiedFoldInfo | null = null;


	private getCM(editor: Editor | null | undefined): EditorView | undefined {
		return (editor as unknown as { cm?: EditorView } | null | undefined)?.cm;
	}

	async onload() {
		this.registerCopyListener();
		this.registerPasteListener();
		this.registerToggleFoldCommand();

		this.registerEditorExtension(
			Prec.highest(
				keymap.of([
					{
						key: 'Tab',
						run: (cmView) => this.handleIndentPreservingFolds(cmView, 'indentMore'),
					},
					{
						key: 'Shift-Tab',
						run: (cmView) => this.handleIndentPreservingFolds(cmView, 'indentLess'),
					},
				]),
			),
		);

	}


	// Feature 1: Paste-preserves-fold-state

	//  Whenever user copies text, records which headings inside the
	//  copied selection were folded, along with the selection's starting
	//  line. 

	private registerCopyListener() {
		this.registerDomEvent(document, 'copy', (_evt: ClipboardEvent) => {
			const ctx = this.app.workspace.activeEditor;
			if (!ctx || !ctx.editor) return;

			const selections = ctx.editor.listSelections();
			if (selections.length !== 1) return; // multi-cursor copy: not handled yet
			//copiedFoldInfo can only hold one selection's fold data so rather than guessing how to merge, fold preservation is skipped; the copy/paste still works, just won't resotre folds

			const selection = selections[0];
			if (!selection) return;
			//anchor/head order depends on drag direction and not document order, so selecting bottom to top 
			//places anchor after head; Normalize with min/max so startLine and endLine are always in document order
			const startLine = Math.min(selection.anchor.line, selection.head.line);
			const endLine = Math.max(selection.anchor.line, selection.head.line);


			const editMode = (
				ctx as unknown as { editMode?: { getFoldInfo?: () => { folds: FoldRange[] } } }
			).editMode;
			const folds: FoldRange[] = editMode?.getFoldInfo?.()?.folds ?? [];

			// Only keep folds fully contained within the copied selection. Overlaps are prevented; Only text selcted within range are used
			const copiedFolds = folds.filter(
				(fold) => fold.from >= startLine && fold.to <= endLine,
			);
			//stores copied Folds for paste listener to use after
			this.copiedFoldInfo = { startLine, folds: copiedFolds };
			//stores copied Folds for paste listener to use after
			this.copiedFoldInfo = { startLine, folds: copiedFolds };
		});
	}


	private registerPasteListener() {
		this.registerEvent(
			this.app.workspace.on('editor-paste', (_evt: ClipboardEvent, editor: Editor) => {
				if (_evt.defaultPrevented) return;
				const copiedInfo = this.copiedFoldInfo;
				if (!copiedInfo || copiedInfo.folds.length === 0) return;

				// Obsidian's public Editor type doesn't expose CM6's EditorView,
				// but `.cm` is the real property at runtime. We need direct CM6
				// access because fold dispatch isn't available through the Obsidian
				// wrapper API.
				const cm = this.getCM(editor);
				if (!cm) return;

				//after paste, curosr selection shows where paste landed, acting as a reference pointfor shifting all old fold positions to new positions
				const pasteSelection = editor.listSelections()[0];
				if (!pasteSelection) return;
				const pasteStartLine = Math.min(
					pasteSelection.anchor.line,
					pasteSelection.head.line,
				);

				window.setTimeout(() => {
					// How far the pasted content landed from where it was originally
					// copied. Every fold's line numbers get shifted by this same
					// amount below, so a fold that was "line 10 to 15" in the original
					// becomes "line 50 to 55" at the new paste location.
					const lineOffset = pasteStartLine - copiedInfo.startLine;
					const foldEffects: StateEffect<{ from: number; to: number }>[] = [];

					// Shifting by lineOffset can push a line number negative (paste
					// near the top of the file) or past the last line (paste near
					// the bottom). Asking CodeMirror for a line that doesn't exist
					// throws, so skip any fold that would land out of bounds instead
					// of restoring a broken/partial fold.
					for (const fold of copiedInfo.folds) {
						const newFromLine = fold.from + lineOffset;
						const newToLine = fold.to + lineOffset;

						// Skip folds that would land outside the document.
						if (newFromLine < 0 || newToLine >= editor.lineCount()) {
							continue;
						}

						// doc.line() (CM6) is 1-indexed but newFromLine/newToLine are 0-indexed
						//(obs editor), so +1 bridges the gap.
						//
						// Fold from .to (end of line), not .from (start of line), folding
						// from the start hides the heading text itself, breaking the
						// fold's visual arrow. Ending at .to allows only the content below
						// the heading to be hidden.
						const newFrom = cm.state.doc.line(newFromLine + 1).to;
						const newTo = cm.state.doc.line(newToLine + 1).to;

						foldEffects.push(foldEffect.of({ from: newFrom, to: newTo }));
					}

					if (foldEffects.length === 0) return;

					// Dispatch largest/outer ranges first so nested
					// folds layer correctly underneath their parent,
					// instead of one fold's decoration overwriting another's.
					foldEffects.sort((a, b) => {
						const sizeA = a.value.to - a.value.from;
						const sizeB = b.value.to - b.value.from;
						return sizeB - sizeA;
					});

					cm.dispatch({ effects: foldEffects });
				}, 0);
			}),
		);
	}

	// Feature 2: Toggle-fold-in-selection
	//  Command: fold or unfold every foldable region inside the current
	//  selection: headings, list items, code blocks, callouts, anything
	//  CM6's syntax tree considers collapsible. Not limited to headings.

	//  Uses the raw CM6 fold API (foldable / foldEffect / unfoldEffect)
	//  rather than Obsidian's heading-specific currentMode.applyFoldInfo,
	//  since that layer only knows about headings.

	private registerToggleFoldCommand() {
		this.addCommand({
			id: 'toggle-fold-in-selection',
			name: 'Toggle fold for everything in selection',
			editorCallback: (editor: Editor) => {
				const cm = this.getCM(editor);
				if (!cm) return;

				const selection = editor.listSelections()[0];
				if (!selection) return;

				const startLine = Math.min(selection.anchor.line, selection.head.line);
				const endLine = Math.max(selection.anchor.line, selection.head.line);

				const state = cm.state;
				const doc = state.doc;

				// Find every foldable range that starts on a line within
				// the selection. `foldable(state, from, to)` is CM6's
				// generic "can this position be collapsed" check.
				const foldableRanges: FoldRange[] = [];
				for (
					let lineNum = startLine + 1;
					lineNum <= endLine + 1 && lineNum <= doc.lines;
					lineNum++
				) {
					const line = doc.line(lineNum);
					const range = foldable(state, line.from, line.to);
					if (range) {
						foldableRanges.push({ from: range.from, to: range.to });
					}
				}

				if (foldableRanges.length === 0) return;

				// Direction is decided by whether ANY of these ranges are
				// currently folded — if so, unfold everything in the
				// selection; otherwise fold everything.
				const currentlyFolded = foldedRanges(state);
				const isAnyFolded = foldableRanges.some((r) => {
					let found = false;
					currentlyFolded.between(r.from, r.to, (from) => {
						if (from === r.from) found = true;
					});
					return found;
				});

				const effects = foldableRanges.map((r) =>
					isAnyFolded ? unfoldEffect.of(r) : foldEffect.of(r),
				);

				cm.dispatch({ effects });
			},
		});
	}


	 //Finds the Obsidian `Editor` whose underlying CM6 view is `cmView`.

	private findEditorForView(cmView: EditorView): Editor | null {
		let found: Editor | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (found) return;
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			if (this.getCM(view.editor) === cmView) {
				found = view.editor;
			}
		});
		return found;
	}

	private handleIndentPreservingFolds(
		cmView: EditorView,
		command: 'indentMore' | 'indentLess',
	): boolean {
		const state = cmView.state;

		// Capture folds as LINE numbers, not character offsets.
		const savedFoldLines: { fromLine: number; toLine: number }[] = [];
		const ranges = foldedRanges(state);
		ranges.between(0, state.doc.length, (from: number, to: number) => {
			const fromLine = state.doc.lineAt(from).number - 1; // 0-indexed again
			const toLine = state.doc.lineAt(to).number - 1;
			savedFoldLines.push({ fromLine, toLine });
		});

		const editor = this.findEditorForView(cmView);
		if (!editor) return false;

		editor.exec(command);

		// Same setTimeout(0) tradeoff as the paste listener above.
		// Accepted risk: on a very slow indent operation, this could
		// no-op instead of restoring folds, rather than crash.
		window.setTimeout(() => {
			const newState = cmView.state;
			const doc = newState.doc;

			const effects = savedFoldLines
				.filter(({ fromLine, toLine }) => fromLine >= 0 && toLine < doc.lines)
				.map(({ fromLine, toLine }) => {
					// Re-derive character offsets from the POST-indent
					// document. `.to` (end of line), not `.from` 
					const newFrom = doc.line(fromLine + 1).to;
					const newTo = doc.line(toLine + 1).to;
					return { from: newFrom, to: newTo };
				})
				// Largest ranges first, so nested folds layer correctly
				// instead of one overwriting another
				.sort((a, b) => (b.to - b.from) - (a.to - a.from))
				.map((r) => foldEffect.of(r));

			cmView.dispatch({ effects });
		}, 0);

		return true; // tell CM6 we've fully handled this key
	}
}