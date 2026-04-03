import type { Extension } from '@codemirror/state';

type LanguageLoader = () => Promise<Extension>;

const LANG_MAP: Record<string, LanguageLoader> = {
  '.md': () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  '.json': () => import('@codemirror/lang-json').then((m) => m.json()),
  '.ts': () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ typescript: true }),
    ),
  '.tsx': () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ typescript: true, jsx: true }),
    ),
  '.js': () =>
    import('@codemirror/lang-javascript').then((m) => m.javascript()),
  '.jsx': () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ jsx: true }),
    ),
  '.yaml': () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  '.yml': () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  '.css': () => import('@codemirror/lang-css').then((m) => m.css()),
  '.html': () => import('@codemirror/lang-html').then((m) => m.html()),
  '.htm': () => import('@codemirror/lang-html').then((m) => m.html()),
  '.py': () => import('@codemirror/lang-python').then((m) => m.python()),
  '.sh': () =>
    Promise.all([
      import('@codemirror/legacy-modes/mode/shell'),
      import('@codemirror/language'),
    ]).then(([shell, lang]) =>
      new lang.LanguageSupport(lang.StreamLanguage.define(shell.shell)),
    ),
  '.bash': () =>
    Promise.all([
      import('@codemirror/legacy-modes/mode/shell'),
      import('@codemirror/language'),
    ]).then(([shell, lang]) =>
      new lang.LanguageSupport(lang.StreamLanguage.define(shell.shell)),
    ),
  '.zsh': () =>
    Promise.all([
      import('@codemirror/legacy-modes/mode/shell'),
      import('@codemirror/language'),
    ]).then(([shell, lang]) =>
      new lang.LanguageSupport(lang.StreamLanguage.define(shell.shell)),
    ),
};

/** Resolve a CodeMirror language extension for the given filename. */
export async function getLanguageExtension(
  filename: string,
): Promise<Extension | null> {
  const ext = filename.includes('.')
    ? '.' + filename.split('.').pop()!.toLowerCase()
    : '';
  const loader = LANG_MAP[ext];
  if (!loader) return null;
  try {
    return await loader();
  } catch {
    return null;
  }
}

/** Whether the given filename should use line wrapping. */
export function shouldWrap(filename: string): boolean {
  const ext = filename.includes('.')
    ? '.' + filename.split('.').pop()!.toLowerCase()
    : '';
  return ext === '.md' || ext === '.txt' || ext === '';
}
