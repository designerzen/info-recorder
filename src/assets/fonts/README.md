# Bundled typefaces

Choose a font in **Settings → Appearance → Fonts → Typeface**. Choices are grouped
into Reading support, Sans-serif, Serif, and Monospace. The preview, app text,
and subtitle font mapping follow the selection. The choice is saved in the URL.

There are 15 choices. OpenDyslexic, Atkinson Hyperlegible, Public Sans, IBM Plex
Sans, Literata, and Space Mono were already bundled. The following additions
come from the official [Google Fonts repository](https://github.com/google/fonts):

| Family | Upstream source | Local prefix |
| --- | --- | --- |
| Readex Pro | [readexpro](https://github.com/google/fonts/tree/main/ofl/readexpro) | `readex-pro` |
| Lexend | [lexend](https://github.com/google/fonts/tree/main/ofl/lexend) | `lexend` |
| Atkinson Hyperlegible Next | [atkinsonhyperlegiblenext](https://github.com/google/fonts/tree/main/ofl/atkinsonhyperlegiblenext) | `atkinson-hyperlegible-next` |
| Atkinson Hyperlegible Mono | [atkinsonhyperlegiblemono](https://github.com/google/fonts/tree/main/ofl/atkinsonhyperlegiblemono) | `atkinson-hyperlegible-mono` |
| Andika | [andika](https://github.com/google/fonts/tree/main/ofl/andika) | `andika` |
| Noto Sans | [notosans](https://github.com/google/fonts/tree/main/ofl/notosans) | `noto-sans` |
| Source Sans 3 | [sourcesans3](https://github.com/google/fonts/tree/main/ofl/sourcesans3) | `source-sans-3` |
| IBM Plex Mono | [ibmplexmono](https://github.com/google/fonts/tree/main/ofl/ibmplexmono) | `ibm-plex-mono` |
| JetBrains Mono | [jetbrainsmono](https://github.com/google/fonts/tree/main/ofl/jetbrainsmono) | `jetbrains-mono` |

The corresponding `*-OFL.txt` files contain the unmodified upstream SIL Open Font
Licenses and copyright notices. Font files are served by the application; choosing
a font makes no request to Google Fonts or another third-party font service.
Only faces requested by the browser are fetched. Full upstream character sets
are retained, rather than subsetting everything to English.

`additional-fonts.css` declares the upstream variable-weight ranges and available
italic faces. Readex Pro and Lexend are upright-only. The existing font choices
retain their original CSS family strings so saved URLs remain compatible.

The subtitle renderer requests bold faces. `scripts/prepare-typefaces.py` creates
static 700-weight instances from the bundled variable fonts for that renderer,
while the interface uses variable faces. Andika and IBM Plex Mono already provide
static bold faces upstream. To regenerate the CSS and subtitle instances, install
`fonttools` in a Python environment, then run:

```sh
python scripts/prepare-typefaces.py
```

This is a contributor tool; the application build does not require Python or
FontTools. The generated fonts and stylesheet are included in the repository.

Font preferences are individual. The picker offers alternatives without claiming
that any one font improves readability for every reader. The
[Braille Institute](https://www.brailleinstitute.org/freefont/) describes the
Hyperlegible family, including Next and Mono; [SIL](https://software.sil.org/andika/)
describes Andika's literacy design; and [JetBrains](https://github.com/JetBrains/JetBrainsMono)
describes its monospace letterforms and symbols.
