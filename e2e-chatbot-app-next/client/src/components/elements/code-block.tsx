import { cn } from '@/lib/utils';
import { useCopyToClipboard } from 'usehooks-ts';
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { CheckIcon, CopyIcon } from '@/components/icons';

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: string;
  showLineNumbers?: boolean;
  children?: ReactNode;
};

type PrismApi = {
  highlight: (code: string, grammar: unknown, language: string) => string;
  languages: Record<string, unknown>;
};

type PrismModule = {
  default?: PrismApi;
} & PrismApi;

let prismCorePromise: Promise<PrismApi> | null = null;
const languageLoadPromises = new Map<string, Promise<void>>();

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  sh: 'bash',
  zsh: 'bash',
  python: 'python',
  py: 'python',
  sql: 'sql',
  spark_sql: 'sql',
  mysql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  json: 'json',
  json5: 'json',
  javascript: 'javascript',
  js: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  markdown: 'markdown',
  md: 'markdown',
  css: 'css',
  scss: 'css',
  less: 'css',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  java: 'java',
  scala: 'scala',
  go: 'go',
  golang: 'go',
  rust: 'rust',
  rs: 'rust',
  diff: 'diff',
  patch: 'diff',
  powershell: 'powershell',
  ps1: 'powershell',
  ini: 'ini',
  env: 'ini',
};

function normalizeLanguage(language: string): string {
  const lowered = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[lowered] ?? (lowered || 'text');
}

async function loadPrismCore(): Promise<PrismApi> {
  if (!prismCorePromise) {
    prismCorePromise = import('prismjs/components/prism-core').then((module) => {
      const prismModule = module as PrismModule;
      return prismModule.default ?? prismModule;
    });
  }
  return prismCorePromise;
}

async function ensureLanguageLoaded(language: string): Promise<void> {
  const normalized = normalizeLanguage(language);
  if (normalized === 'text' || normalized === 'plain' || normalized === 'plaintext') {
    return;
  }

  if (languageLoadPromises.has(normalized)) {
    await languageLoadPromises.get(normalized);
    return;
  }

  const promise = (async () => {
    switch (normalized) {
      case 'markup':
        await import('prismjs/components/prism-markup');
        break;
      case 'css':
        await import('prismjs/components/prism-css');
        break;
      case 'bash':
        await import('prismjs/components/prism-bash');
        break;
      case 'python':
        await import('prismjs/components/prism-python');
        break;
      case 'sql':
        await import('prismjs/components/prism-sql');
        break;
      case 'json':
        await import('prismjs/components/prism-json');
        break;
      case 'javascript':
        await import('prismjs/components/prism-clike');
        await import('prismjs/components/prism-javascript');
        break;
      case 'typescript':
        await ensureLanguageLoaded('javascript');
        await import('prismjs/components/prism-typescript');
        break;
      case 'jsx':
        await ensureLanguageLoaded('markup');
        await ensureLanguageLoaded('javascript');
        await import('prismjs/components/prism-jsx');
        break;
      case 'tsx':
        await ensureLanguageLoaded('jsx');
        await ensureLanguageLoaded('typescript');
        await import('prismjs/components/prism-tsx');
        break;
      case 'markdown':
        await import('prismjs/components/prism-markdown');
        break;
      case 'yaml':
        await import('prismjs/components/prism-yaml');
        break;
      case 'toml':
        await import('prismjs/components/prism-toml');
        break;
      case 'java':
        await import('prismjs/components/prism-java');
        break;
      case 'scala':
        await import('prismjs/components/prism-scala');
        break;
      case 'go':
        await import('prismjs/components/prism-go');
        break;
      case 'rust':
        await import('prismjs/components/prism-rust');
        break;
      case 'diff':
        await import('prismjs/components/prism-diff');
        break;
      case 'powershell':
        await import('prismjs/components/prism-powershell');
        break;
      case 'ini':
        await import('prismjs/components/prism-ini');
        break;
      default:
        break;
    }
  })();

  languageLoadPromises.set(normalized, promise);
  await promise;
}

const renderFallbackCodeSurface = ({
  code,
  className,
  children,
  props,
  showLineNumbers,
  actions,
}: {
  code: string;
  className?: string;
  children?: ReactNode;
  props?: HTMLAttributes<HTMLDivElement>;
  showLineNumbers?: boolean;
  actions?: ReactNode;
}) => {
  const lines = code.split('\n');

  return (
    <div
      className={cn(
        'code-block-surface group/code-block relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101214] text-white shadow-[0_18px_50px_rgba(0,0,0,0.28)]',
        className,
      )}
      {...(props ?? {})}
    >
      <div className="relative overflow-x-auto px-[1.15rem] py-[1.05rem]">
        {showLineNumbers ? (
          <div className="grid min-w-fit grid-cols-[auto_1fr] gap-x-4 font-mono text-[0.88rem] leading-[1.72] text-[#f3f5f7]">
            {lines.map((line, index) => (
              <Fragment key={`line-${index}`}>
                <span className="select-none text-right text-[#4f5a67]">
                  {index + 1}
                </span>
                <span className="whitespace-pre">{line || ' '}</span>
              </Fragment>
            ))}
          </div>
        ) : (
          <pre className="m-0 whitespace-pre font-mono text-[0.88rem] leading-[1.72] text-[#f3f5f7]">
            <code>{code}</code>
          </pre>
        )}
        {actions || children ? (
          <div className="absolute top-2 right-2 flex items-center gap-2">
            {actions}
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [_, copyToClipboard] = useCopyToClipboard();
  const normalizedLanguage = useMemo(() => normalizeLanguage(language), [language]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopied(false);
    }, 1600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [copied]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const prism = await loadPrismCore();
        await ensureLanguageLoaded(normalizedLanguage);
        const grammar = prism.languages[normalizedLanguage];
        if (!grammar) {
          if (!cancelled) setHighlightedHtml(null);
          return;
        }
        const html = prism.highlight(code, grammar, normalizedLanguage);
        if (!cancelled) {
          setHighlightedHtml(html);
        }
      } catch {
        if (!cancelled) {
          setHighlightedHtml(null);
        }
      }
    };

    setHighlightedHtml(null);
    void load();

    return () => {
      cancelled = true;
    };
  }, [code, normalizedLanguage]);

  const handleCopy = async () => {
    try {
      await copyToClipboard(code);
      setCopied(true);
    } catch {
      toast.error('Failed to copy code.');
    }
  };

  const copyAction = (
    <button
      type="button"
      onClick={() => {
        void handleCopy();
      }}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-lg border backdrop-blur-sm transition',
        copied
          ? 'border-emerald-300/22 bg-emerald-300/[0.08] text-emerald-100'
          : 'border-white/[0.06] bg-black/20 text-white/42 hover:border-white/[0.12] hover:bg-black/32 hover:text-white/78',
      )}
      aria-label={copied ? 'Code copied' : 'Copy code'}
      title={copied ? 'Copied' : 'Copy code'}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </button>
  );

  if (!highlightedHtml || showLineNumbers) {
    return renderFallbackCodeSurface({
      code,
      className,
      children,
      props,
      showLineNumbers,
      actions: copyAction,
    });
  }

  return (
    <div
      className={cn(
        'code-block-surface group/code-block relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101214] text-white shadow-[0_18px_50px_rgba(0,0,0,0.28)]',
        className,
      )}
      {...props}
    >
      <div className="relative overflow-x-auto px-[1.15rem] py-[1.05rem]">
        <pre className="m-0 whitespace-pre font-mono text-[0.88rem] leading-[1.72] text-[#f3f5f7]">
          <code
            className={`language-${normalizedLanguage}`}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
        {copyAction || children ? (
          <div className="absolute top-2 right-2 flex items-center gap-2">
            {copyAction}
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
};
