import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';
import { createContext } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';

const darkCodeTheme = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...(oneDark['pre[class*="language-"]'] || {}),
    background: '#111318',
    color: '#f8fafc',
    textShadow: 'none',
  },
  'code[class*="language-"]': {
    ...(oneDark['code[class*="language-"]'] || {}),
    color: '#f8fafc',
    textShadow: 'none',
    fontFamily:
      'JetBrains Mono, SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace',
  },
  'comment': {
    color: '#8b98ad',
  },
  'prolog': {
    color: '#8b98ad',
  },
  'doctype': {
    color: '#8b98ad',
  },
  'cdata': {
    color: '#8b98ad',
  },
  'punctuation': {
    color: '#d7dee9',
  },
  'property': {
    color: '#7dd3fc',
  },
  'tag': {
    color: '#fda4af',
  },
  'boolean': {
    color: '#f9a8d4',
  },
  'number': {
    color: '#f9a8d4',
  },
  'constant': {
    color: '#f9a8d4',
  },
  'symbol': {
    color: '#f9a8d4',
  },
  'deleted': {
    color: '#fda4af',
  },
  'selector': {
    color: '#86efac',
  },
  'attr-name': {
    color: '#f8fafc',
  },
  'string': {
    color: '#86efac',
  },
  'char': {
    color: '#86efac',
  },
  'builtin': {
    color: '#c4b5fd',
  },
  'inserted': {
    color: '#86efac',
  },
  'operator': {
    color: '#d7dee9',
  },
  'entity': {
    color: '#93c5fd',
    cursor: 'help',
  },
  'url': {
    color: '#93c5fd',
  },
  'atrule': {
    color: '#c4b5fd',
  },
  'attr-value': {
    color: '#86efac',
  },
  'keyword': {
    color: '#93c5fd',
  },
  'function': {
    color: '#fcd34d',
  },
  'class-name': {
    color: '#fcd34d',
  },
  'regex': {
    color: '#fdba74',
  },
  'important': {
    color: '#fcd34d',
    fontWeight: '600',
  },
  'variable': {
    color: '#f8fafc',
  },
  'bold': {
    fontWeight: '700',
  },
  'italic': {
    fontStyle: 'italic',
  },
};

type CodeBlockContextType = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: '',
});

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: string;
  showLineNumbers?: boolean;
  children?: ReactNode;
};

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => (
  <CodeBlockContext.Provider value={{ code }}>
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111318] text-white shadow-[0_18px_50px_rgba(0,0,0,0.28)]',
        className,
      )}
      {...props}
    >
      <div className="relative">
        <SyntaxHighlighter
          className="overflow-hidden dark:hidden"
          codeTagProps={{
            className: 'font-mono text-sm',
          }}
          customStyle={{
            margin: 0,
            padding: '1rem 1.1rem',
            fontSize: '0.84rem',
            lineHeight: '1.65',
            background: '#f7f8fb',
            color: '#0f172a',
            overflowX: 'auto',
            overflowWrap: 'normal',
            wordBreak: 'normal',
          }}
          language={language}
          lineNumberStyle={{
            color: 'hsl(var(--muted-foreground))',
            paddingRight: '1rem',
            minWidth: '2.5rem',
          }}
          showLineNumbers={showLineNumbers}
          style={oneLight}
        >
          {code}
        </SyntaxHighlighter>
        <SyntaxHighlighter
          className="hidden overflow-hidden dark:block"
          codeTagProps={{
            className: 'font-mono text-sm',
          }}
          customStyle={{
            margin: 0,
            padding: '1.05rem 1.15rem',
            fontSize: '0.88rem',
            lineHeight: '1.72',
            background: '#111318',
            color: '#f8fafc',
            overflowX: 'auto',
            overflowWrap: 'normal',
            wordBreak: 'normal',
          }}
          language={language}
          lineNumberStyle={{
            color: 'rgba(203, 213, 225, 0.5)',
            paddingRight: '1rem',
            minWidth: '2.5rem',
          }}
          showLineNumbers={showLineNumbers}
          style={darkCodeTheme}
        >
          {code}
        </SyntaxHighlighter>
        {children && (
          <div className="absolute top-2 right-2 flex items-center gap-2">
            {children}
          </div>
        )}
      </div>
    </div>
  </CodeBlockContext.Provider>
);
