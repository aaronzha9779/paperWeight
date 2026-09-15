# paperWeight

Keeps your folded headings completely folded, even after copy/paste or indenting.

## The problem
Obsidian unfolds everything when you paste text, and re-indenting a folded
section can knock its fold state loose. If you rely on folded headings to
keep long notes organized, this gets annoying fast.

## Features

**Paste preserves folds**
Copy a folded section and paste it elsewhere (even in a different note): 
its folded parts stay folded, instead of Obsidian automatically unfolding everything on
paste.

<img width="800" height="808" alt="copy" src="https://github.com/user-attachments/assets/f1745fef-735d-4ad1-8e9c-672039f044b1" />


**Toggle fold for everything in a selection**
Select a range of text and run **"Toggle fold for everything in selection"**
from the command palette to fold or unfold every heading, list item, code
block, or callout inside it in one go. The toggle is configurable to any keybind. 

<img width="800" height="808" alt="toggle" src="https://github.com/user-attachments/assets/78909777-acba-4e1f-9d93-41d397cbb95f" />


**Indent-safe folding**
Tab / Shift-Tab to indent or outdent text no longer disrupts existing folds
in the document.

<img width="800" height="469" alt="shiftTab" src="https://github.com/user-attachments/assets/812250d7-7344-4711-ae9f-eab7b787ddcb" />


## Installation

### From Obsidian 
1. Open **Settings → Community plugins**
2. Click **Browse** and search for "paperWeight"
3. Click **Install**, then **Enable**

### Manual installation
1. Download `main.js`, `manifest.json`, and `styles.css` (if present) from the
   [latest release](../../releases)
2. Create a folder `paperWeight` inside your vault's
   `.obsidian/plugins/` directory
3. Copy the downloaded files into that folder
4. Reload Obsidian and enable **PaperWeight** under
   **Settings → Community plugins**

## Usage

- **Copy/paste**: works automatically, no setup needed.
- **Toggle fold in selection**: select text, then run the command from the
  command palette (`Ctrl/Cmd + P`), or select keybind in settings.
- **Indent-safe folding**: works automatically on load, no setup needed.

## Known limitations

- Multi-cursor copy (multiple simultaneous selections) does not currently
  preserve fold state: copy/paste will still work normally, folds just won't
  be restored in that case.

## Support

Found a bug or have a feature request? Please
[open an issue](../../issues).

## License

[MIT](LICENSE)
